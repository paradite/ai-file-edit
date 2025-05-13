# send-prompt

[![NPM version](https://img.shields.io/npm/v/send-prompt)](https://www.npmjs.com/package/send-prompt)

A lightweight library to send prompt to models, developed by [16x Prompt](https://prompt.16x.engineer) and [16x Eval](https://eval.16x.engineer).

The library uses [llm-info](https://www.npmjs.com/package/llm-info) for model and provider information.

## Features

- 🔄 Unified interface with single entry point for all providers
- 🤖 Support for multiple AI providers:
  - OpenAI (GPT-4.1)
  - Anthropic (Claude 3.7 Sonnet)
  - Google (Gemini 2.5 Pro)
- 🔧 Function calling support for all providers
- 💬 Standardized message format across providers
- 🛠️ Tool definitions with TypeScript support
- 🔒 Browser-safe with proper API key handling
- 📝 System prompt support
- 🎯 Consistent response format

## Installation

```bash
npm install llm-info send-prompt
```

## Usage

### Basic Usage

The same function `sendPrompt` works across all providers:

```typescript
import {sendPrompt} from 'send-prompt';
import {AI_PROVIDERS, ModelEnum} from 'llm-info';

// OpenAI
const openaiResponse = await sendPrompt({
  messages: [{role: 'user', content: 'Hello, who are you?'}],
  model: ModelEnum['gpt-4.1'],
  provider: AI_PROVIDERS.OPENAI,
  apiKey: 'your-openai-api-key',
  systemPrompt: 'You are a helpful assistant.',
});

// Anthropic
const anthropicResponse = await sendPrompt({
  messages: [{role: 'user', content: 'Hello, who are you?'}],
  model: ModelEnum['claude-3-7-sonnet-20250219'],
  provider: AI_PROVIDERS.ANTHROPIC,
  apiKey: 'your-anthropic-api-key',
  systemPrompt: 'You are a helpful assistant.',
});

// Google
const googleResponse = await sendPrompt({
  messages: [{role: 'user', content: 'Hello, who are you?'}],
  model: ModelEnum['gemini-2.5-pro-exp-03-25'],
  provider: AI_PROVIDERS.GOOGLE,
  apiKey: 'your-google-api-key',
  systemPrompt: 'You are a helpful assistant.',
});

// All responses have the same structure
console.log(openaiResponse.message.content);
console.log(anthropicResponse.message.content);
console.log(googleResponse.message.content);
```

### Function Calling

```typescript
// Define your tool
const calculatorTool = {
  type: 'function',
  function: {
    name: 'calculator',
    description: 'Perform basic arithmetic calculations',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['add', 'subtract', 'multiply', 'divide'],
          description: 'The arithmetic operation to perform',
        },
        a: {
          type: 'number',
          description: 'First number',
        },
        b: {
          type: 'number',
          description: 'Second number',
        },
      },
      required: ['operation', 'a', 'b'],
      additionalProperties: false,
    },
    strict: true,
  },
};

const response = await sendPrompt({
  messages: [{role: 'user', content: 'What is 5 plus 3?'}],
  model: ModelEnum['gpt-4.1'],
  provider: AI_PROVIDERS.OPENAI,
  apiKey: 'your-openai-api-key',
  tools: [calculatorTool],
});

// Expected response structure:
// {
//   tool_calls: [
//     {
//       id: "call_123",
//       type: "function",
//       function: {
//         name: "calculator",
//         arguments: '{"operation":"add","a":5,"b":3}'
//       }
//     }
//   ]
// }

// Handle the function call
if (response.tool_calls) {
  const toolCall = response.tool_calls[0];
  console.log('Tool called:', toolCall.function.name);
  console.log('Arguments:', JSON.parse(toolCall.function.arguments));
}
```

### Multi-round Tool Calls (Google)

For Google's Gemini models, you can handle multi-round tool calls by including function call and response messages in the conversation:

```typescript
// First round - model makes a function call
const firstResponse = await sendPrompt({
  messages: [{role: 'user', content: 'What is 15 plus 32?'}],
  model: ModelEnum['gemini-2.5-pro-exp-03-25'],
  provider: AI_PROVIDERS.GOOGLE,
  apiKey: 'your-google-api-key',
  tools: [calculatorTool],
  toolCallMode: 'AUTO',
});

// Handle the function call and get the result
if (firstResponse.tool_calls) {
  const toolCall = firstResponse.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  const result = calculate(args.operation, args.a, args.b); // Your calculation function

  // Second round - include function call and response in messages
  const secondResponse = await sendPrompt({
    messages: [
      {role: 'user', content: 'What is 15 plus 32?'},
      {
        role: 'google_function_call',
        id: toolCall.id,
        name: toolCall.function.name,
        args: args,
      },
      {
        role: 'google_function_response',
        id: toolCall.id,
        name: toolCall.function.name,
        response: {result},
      },
    ],
    model: ModelEnum['gemini-2.5-pro-exp-03-25'],
    provider: AI_PROVIDERS.GOOGLE,
    apiKey: 'your-google-api-key',
    tools: [calculatorTool],
    toolCallMode: 'AUTO',
  });

  // The model will now respond with the final answer
  console.log('Final response:', secondResponse.message.content);
}
```

The multi-round tool calling process involves:

1. First round: Model makes a function call
2. Your code executes the function and gets the result
3. Second round: Include both the function call and its response in the messages
4. Model provides the final response using the function result
