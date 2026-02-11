import { createAgentTool } from '../src/shared/toolFactory';
import { z } from 'zod';

describe('toolFactory', () => {
	it('creates a DynamicStructuredTool with correct name and description', () => {
		const tool = createAgentTool({
			name: 'test_tool',
			description: 'A test tool',
			schema: z.object({ input: z.string() }),
			func: async () => 'result',
		});

		expect(tool.name).toBe('test_tool');
		expect(tool.description).toBe('A test tool');
	});

	it('invokes the func and returns result', async () => {
		const tool = createAgentTool({
			name: 'echo_tool',
			description: 'Echoes input',
			schema: z.object({ msg: z.string() }),
			func: async (input) => `echo: ${input.msg}`,
		});

		const result = await tool.invoke({ msg: 'hello' });
		expect(result).toBe('echo: hello');
	});

	it('catches Error instances and returns error message', async () => {
		const tool = createAgentTool({
			name: 'failing_tool',
			description: 'Always fails',
			schema: z.object({ input: z.string() }),
			func: async () => { throw new Error('Something went wrong'); },
		});

		const result = await tool.invoke({ input: 'test' });
		expect(result).toBe('Error: Something went wrong');
	});

	it('catches non-Error thrown values and converts to string', async () => {
		const tool = createAgentTool({
			name: 'string_error_tool',
			description: 'Throws string',
			schema: z.object({ input: z.string() }),
			func: async () => { throw 'raw string error'; },
		});

		const result = await tool.invoke({ input: 'test' });
		expect(result).toBe('Error: raw string error');
	});

	it('handles thrown objects', async () => {
		const tool = createAgentTool({
			name: 'object_error_tool',
			description: 'Throws object',
			schema: z.object({}),
			func: async () => { throw { code: 500, message: 'fail' }; },
		});

		const result = await tool.invoke({});
		expect(result).toContain('Error:');
	});
});
