/**
 * Tool Loop
 *
 * Runs a model conversation until the model stops asking for tools: call the
 * model, run each tool it asked for, append the results, and repeat.
 *
 * Every model call and tool execution goes to the run recorder, so a turn's
 * seam can show the whole exchange. Tool failures go back to the model as
 * results rather than being thrown, so it can recover.
 */

export const DEFAULT_MAX_ITERATIONS = 8;

export class ToolLoopError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {Array<Object>} [details.messages] - The conversation when the loop gave up.
   */
  constructor(message, { messages = [] } = {}) {
    super(message);
    this.name = 'ToolLoopError';
    this.messages = messages;
  }
}

/**
 * The assistant message to append to the conversation. reasoning_content
 * stays on it: with tools in a request, DeepSeek requires every earlier
 * assistant turn's reasoning to be sent back.
 */
function assistantMessage(result) {
  const message = { role: 'assistant', content: result.content ?? '' };
  if (result.reasoning) message.reasoning_content = result.reasoning;
  if (result.toolCalls.length > 0) message.tool_calls = result.toolCalls;
  return message;
}

function toolFailure(message) {
  return { content: JSON.stringify({ error: message }), error: message, args: null, value: null };
}

async function executeToolCall(call, handlers, signal) {
  const name = call.function?.name;
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
  if (!handler) return toolFailure(`Unknown tool: ${name}`);

  let args;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return toolFailure(`Arguments for ${name} were not valid JSON`);
  }

  try {
    const value = await handler(args, { signal });
    return {
      content: typeof value === 'string' ? value : JSON.stringify(value ?? null),
      error: null,
      args,
      value,
    };
  } catch (error) {
    // A cancelled run should stop, not hand the model an error to work around.
    if (signal?.aborted) throw error;
    return toolFailure(error.message);
  }
}

/**
 * @param {Object} params
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {string} params.role - Pipeline role recorded on each step, e.g. 'director'.
 * @param {Array<Object>} params.messages - Starting conversation; not mutated. Earlier
 *   assistant messages must keep their reasoning_content (see assistantMessage).
 * @param {Array<Object>} params.tools - Tool definitions: { name, description, parameters }.
 * @param {Object<string, Function>} params.handlers - Tool name to
 *   `async (args, { signal }) => result`. Strings reach the model as-is; anything
 *   else is JSON-encoded.
 * @param {Object} [params.options] - More chat options: thinking, strict, maxTokens, ...
 * @param {import('./run-recorder.js').RunRecorder|null} [params.recorder]
 * @param {number} [params.maxIterations] - Model calls allowed before giving up.
 * @param {string|null} [params.finalTool] - A tool that ends the loop: once a call to it
 *   succeeds, the loop returns without calling the model again.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ content: string, reasoning: string, messages: Array<Object>,
 *   iterations: number, finishReason: string|null,
 *   finalCall: { arguments: Object, result: * }|null }>}
 * @throws {ToolLoopError} When the model is still calling tools after maxIterations calls.
 */
export async function runToolLoop({
  client,
  role,
  messages,
  tools,
  handlers,
  options = {},
  recorder = null,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  finalTool = null,
  signal,
}) {
  const history = [...messages];
  // Steps record only the messages added since the previous model call, so a
  // long prompt is stored once per run rather than once per call.
  let recordedUpTo = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const recordedRequest = {
      ...options,
      model: options.model || client.model,
      messageOffset: recordedUpTo,
      messages: history.slice(recordedUpTo),
      ...(iteration === 1 ? { tools } : {}),
    };
    recordedUpTo = history.length;

    const started = Date.now();
    let result;
    try {
      result = await client.chat({ ...options, messages: [...history], tools, signal });
    } catch (error) {
      recorder?.recordStep({
        role,
        kind: 'model',
        request: recordedRequest,
        error: error.message,
        durationMs: Date.now() - started,
      });
      throw error;
    }

    recorder?.recordStep({
      role,
      kind: 'model',
      request: recordedRequest,
      response: { content: result.content, finishReason: result.finishReason, model: result.model },
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      usage: result.usage,
      durationMs: Date.now() - started,
    });

    history.push(assistantMessage(result));

    const finished = (finalCall) => ({
      content: result.content,
      reasoning: result.reasoning,
      messages: history,
      iterations: iteration,
      finishReason: result.finishReason,
      finalCall,
    });

    if (result.toolCalls.length === 0) {
      return finished(null);
    }

    // Run tools only when the model will get to see their results. Tools that
    // write (memories, draft characters) must not act on a run about to fail.
    // The final tool is the exception, since nothing needs to see its result.
    const lastCall = iteration === maxIterations;
    const calls = lastCall
      ? result.toolCalls.filter((call) => finalTool && call.function?.name === finalTool)
      : result.toolCalls;
    if (calls.length === 0) break;

    let finalCall = null;
    for (const call of calls) {
      const toolStarted = Date.now();
      const outcome = await executeToolCall(call, handlers, signal);
      recorder?.recordStep({
        role,
        kind: 'tool',
        request: { id: call.id, name: call.function?.name, arguments: call.function?.arguments },
        response: outcome.content,
        error: outcome.error,
        durationMs: Date.now() - toolStarted,
      });
      history.push({ role: 'tool', tool_call_id: call.id, content: outcome.content });
      if (finalTool && call.function?.name === finalTool && !outcome.error) {
        finalCall = { arguments: outcome.args, result: outcome.value };
      }
    }
    if (finalCall) {
      return finished(finalCall);
    }
    if (lastCall) break;
  }

  throw new ToolLoopError(`The model was still calling tools after ${maxIterations} calls`, {
    messages: history,
  });
}
