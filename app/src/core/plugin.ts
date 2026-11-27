import type { ComponentType } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

/** What a plugin's tools and views receive. */
export type PluginContext = {
  db: SQLiteDatabase;
  /** Tells open views that this plugin's data changed. */
  notifyChanged(): void;
  /** Tools of the enabled plugins, e.g. for routines to check a `run_tool` action. */
  enabledTools(): Promise<Tool<any>[]>;
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
  /** Short Portuguese name of the action ("Registrar gasto"), shown on the chat's tool card next to the plugin name. */
  label: string;
  description: string;
  parameters: ParameterSchema;
  run(params: P, ctx: PluginContext): Promise<ToolResult>;
  /**
   * A routine may call it with no model and nobody present (`run_tool`, ADR
   * 0005). Only local tools (no network) with flat parameters (string,
   * number, integer, boolean); the handler must validate its input and
   * avoid duplicates, since a failure can be retried.
   */
  routineAction?: boolean;
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
  /**
   * Called with the plugin's state at startup and whenever the user flips
   * its switch, for plugins with work outside JS (e.g. native triggers).
   */
  onEnabledChange?(enabled: boolean): void | Promise<void>;
};
