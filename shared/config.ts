// import * as vscode from 'vscode';

export const DEFAULT_WATCH_PATTERNS = [
  '*.c',
  '*.cp',
  '*.cpp',
  '*.cxx',
  '*.h',
  '*.hp',
  '*.hpp',
  '*.hxx',
  '*.s',
  '*.S',
  '*.asm',
  '*.inc',
  '*.py',
  '*.yml',
  '*.txt',
  '*.json',
];

/**
 * Configuration file for objdiff
 */
export interface ObjdiffConfiguration {
  /**
   * Minimum version of objdiff required to load this configuration file.
   */
  min_version?: string;
  /**
   * By default, objdiff will use make to build the project.
   * If the project uses a different build system (e.g. ninja), specify it here.
   * The build command will be `[custom_make] [custom_args] path/to/object.o`.
   */
  custom_make?: string;
  /**
   * Additional arguments to pass to the build command prior to the object path.
   */
  custom_args?: string[];
  /**
   * Relative from the root of the project, this where the "target" or "expected" objects are located.
   * These are the intended result of the match.
   */
  target_dir?: string;
  /**
   * Relative from the root of the project, this is where the "base" or "actual" objects are located.
   * These are objects built from the current source code.
   */
  base_dir?: string;
  /**
   * If true, objdiff will tell the build system to build the target objects before diffing (e.g. `make path/to/target.o`).
   * This is useful if the target objects are not built by default or can change based on project configuration or edits to assembly files.
   * Requires the build system to be configured properly.
   */
  build_target?: boolean;
  /**
   * If true, objdiff will tell the build system to build the base objects before diffing (e.g. `make path/to/base.o`).
   * It's unlikely you'll want to disable this, unless you're using an external tool to rebuild the base object on source file changes.
   */
  build_base?: boolean;
  /**
   * List of glob patterns to watch for changes in the project.
   * If any of these files change, objdiff will automatically rebuild the objects and re-compare them.
   * Supported syntax: https://docs.rs/globset/latest/globset/#syntax
   */
  watch_patterns?: string[];
  /**
   * Use units instead.
   */
  objects?: Unit[];
  /**
   * If specified, objdiff will display a list of objects in the sidebar for easy navigation.
   */
  units?: Unit[];
  /**
   * Progress categories used for objdiff-cli report.
   */
  progress_categories?: ProgressCategory[];
}
export interface Unit {
  /**
   * The name of the object in the UI. If not specified, the object's path will be used.
   */
  name?: string;
  /**
   * Relative path to the object from the target_dir and base_dir.
   * Requires target_dir and base_dir to be specified.
   */
  path?: string;
  /**
   * Path to the target object from the project root.
   * Required if path is not specified.
   */
  target_path?: string;
  /**
   * Path to the base object from the project root.
   * Required if path is not specified.
   */
  base_path?: string;
  /**
   * Displays function symbols in reversed order.
   * Used to support MWCC's -inline deferred option, which reverses the order of functions in the object file.
   */
  reverse_fn_order?: boolean;
  /**
   * Marks the object as "complete" (or "linked") in the object list.
   * This is useful for marking objects that are fully decompiled. A value of `false` will mark the object as "incomplete".
   */
  complete?: boolean;
  /**
   * If present, objdiff will display a button to create a decomp.me scratch.
   */
  scratch?: Scratch;
  /**
   * Metadata for the object.
   */
  metadata?: Metadata;
  /**
   * Manual symbol mappings from target to base.
   */
  symbol_mappings?: {
    [k: string]: string;
  };
}
export interface Scratch {
  /**
   * The decomp.me platform ID to use for the scratch.
   */
  platform?: string;
  /**
   * The decomp.me compiler ID to use for the scratch.
   */
  compiler?: string;
  /**
   * C flags to use for the scratch. Exclude any include paths.
   */
  c_flags?: string;
  /**
   * Path to the context file to use for the scratch.
   */
  ctx_path?: string;
  /**
   * If true, objdiff will run the build command with the context file as an argument to generate it.
   */
  build_ctx?: boolean;
}
export interface Metadata {
  /**
   * Marks the object as "complete" (or "linked") in the object list.
   * This is useful for marking objects that are fully decompiled. A value of `false` will mark the object as "incomplete".
   */
  complete?: boolean;
  /**
   * Displays function symbols in reversed order.
   * Used to support MWCC's -inline deferred option, which reverses the order of functions in the object file.
   */
  reverse_fn_order?: boolean;
  /**
   * Path to the source file that generated the object.
   */
  source_path?: string;
  /**
   * Progress categories used for objdiff-cli report.
   */
  progress_categories?: string[];
  /**
   * Hides the object from the object list by default, but still includes it in reports.
   */
  auto_generated?: boolean;
}
export interface ProgressCategory {
  /**
   * Unique identifier for the category.
   */
  id?: string;
  /**
   * Human-readable name of the category.
   */
  name?: string;
}

export function resolveConfig(config: ObjdiffConfiguration) {
  if (config.watch_patterns === undefined) {
    config.watch_patterns = DEFAULT_WATCH_PATTERNS;
  }
  if (config.build_target === undefined) {
    config.build_target = false;
  }
  if (config.build_base === undefined) {
    config.build_base = true;
  }
  if (config.units === undefined) {
    config.units = config.objects || [];
  }
  for (const unit of config.units || []) {
    unit.name = unit.name || unit.path || '<unnamed>';
    if (unit.path) {
      if (config.target_dir && !unit.target_path) {
        unit.target_path = `${config.target_dir}/${unit.path}`;
      }
      if (config.base_dir && !unit.base_path) {
        unit.base_path = `${config.base_dir}/${unit.path}`;
      }
    }
    unit.metadata = unit.metadata || {};
    if (unit.complete !== undefined && unit.metadata.complete === undefined) {
      unit.metadata.complete = unit.complete;
    }
    if (
      unit.reverse_fn_order !== undefined &&
      unit.metadata.reverse_fn_order === undefined
    ) {
      unit.metadata.reverse_fn_order = unit.reverse_fn_order;
    }
  }
  return config;
}
