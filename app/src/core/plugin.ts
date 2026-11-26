import type { ComponentType } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

/** What a plugin's tools and views receive. */
export type PluginContext = {
  db: SQLiteDatabase;
  /** Tells open views that this plugin's data changed. */
  notifyChanged(): void;
};

/** Result of running a tool: a short reply for the voice session ("Anotado."). */
export type ToolResult = { ok: boolean; reply: string };

/** Subset of JSON Schema for one value. Nested objects and lists describe richer inputs, like a routine. */
export type ValueSchema =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number' | 'integer' | 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: ValueSchema; minItems?: number; maxItems?: number }
  | ObjectSchema
  | { anyOf: ValueSchema[]; description?: string };

export type ObjectSchema = {
  type: 'object';
  description?: string;
  properties: Record<string, ValueSchema>;
  required?: string[];
};

/** Subset of JSON Schema used to describe tool parameters to the agent. */
export type ParameterSchema = ObjectSchema;

/** An action the agent can call. `name` is namespaced: `<pluginId>.<action>`. */
export type Tool<P = Record<string, unknown>> = {
  name: string;
  description: string;
  parameters: ParameterSchema;
  run(params: P, ctx: PluginContext): Promise<ToolResult>;
};

/** A screen shown as an item of the app's side panel. */
export type PluginView = {
  title: string;
  Component: ComponentType<{ ctx: PluginContext }>;
};

/** A schema step for the plugin's own tables (prefixed with the plugin id). */
export type Migration = { version: number; sql: string };

/**
 * A first-party plugin compiled into the app (ADR 0003). Tools and view are
 * optional; disabling a plugin hides both but keeps its data.
 */
export type Plugin = {
  id: string;
  name: string;
  version: string;
  enabledByDefault: boolean;
  tools?: Tool<any>[];
  view?: PluginView;
  migrations?: Migration[];
};
