import { DynamicStructuredTool } from '@langchain/core/tools';

interface ToolDefinition {
	name: string;
	description: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	schema: any;
	func: (input: Record<string, unknown>) => Promise<string>;
}

export function createAgentTool(definition: ToolDefinition): DynamicStructuredTool {
	return new DynamicStructuredTool({
		name: definition.name,
		description: definition.description,
		schema: definition.schema,
		func: async (input: Record<string, unknown>) => {
			try {
				return await definition.func(input);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return `Error: ${message}`;
			}
		},
	});
}
