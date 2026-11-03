/**
 * The script VM's public surface (AD-22: the harness reaches it through
 * `@tk-reawakened/core` only).
 *
 * docs/adr/0004 (the AST, Step IR and plugin chain); docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands/
 * docs/spec/engine/rpgcode-runtime.md.
 */

export {
  ASSIGN_READ_ONLY,
  CALLABLE_ARITY,
  CALLABLE_NOT_CALLABLE,
  CALLABLE_UNKNOWN_DEF,
  failureClass,
  HANDLER_NOT_HANDLING,
  HANDLER_TOP_LEVEL,
  HANDLER_UNKNOWN_LABEL,
  INCLUDE_CYCLE,
  INCLUDE_MISSING,
  INCLUDE_REFUSED,
  KILL_SYSTEM_OWNED,
  locateError,
  OBJECT_ABSTRACT_CLASS,
  OBJECT_INACCESSIBLE_MEMBER,
  OBJECT_INVALID,
  PROGRAM_COMPILED,
  RESTORE_CALLABLE_CAPTURES,
  RESTORE_CALLABLE_MALFORMED,
  RESTORE_CALLABLE_UNKNOWN_DEF,
  RESTORE_CALLABLE_RECEIVER,
  RESTORE_CELL_MISSING,
  RESTORE_CELL_SEQ,
  ScriptError,
  toDiagnostic,
} from "./errors.ts";
export type { FailureClass } from "./errors.ts";
export { compileRestoredPrograms, verifyRestoredHandles } from "./restore-check.ts";
export type { RestoreCheckServices } from "./restore-check.ts";
export type { BinaryOp, SourcePos, StepOp, UnaryOp } from "./ops.ts";
export type {
  Ast,
  Block,
  Expr,
  FunctionDef,
  IfBranch,
  Param,
  Statement,
  SwitchCase,
} from "./ast.ts";
export { foldAscii, scan, tokenize, tokenizeObjects } from "./lex.ts";
export type { Token } from "./lex.ts";
export { MODULE_COMMANDS, parse } from "./parse.ts";
export type { ParseContext } from "./parse.ts";
export { compileTk2, normaliseTk2, parseTk2 } from "./tk2.ts";
export type { Tk2CommandLookup } from "./tk2.ts";
export { lower } from "./lower.ts";
export type {
  CompiledClass,
  FunctionInfo,
  LowerResult,
  ParamInfo,
  StatementRange,
} from "./lower.ts";
export {
  IR_VERSION,
  compileInline,
  compileProgram,
  fileProgramRef,
  programKey,
  withOwner,
  withRedirects,
} from "./program.ts";
export type {
  CompileContext,
  Program,
  ProgramNotice,
  ProgramRef,
  ProgramUnit,
  RedirectPairs,
  ScriptDialect,
} from "./program.ts";
export { readProgram, resolveProgram } from "./loader.ts";
export type { LoadedSource, ProgramLoader } from "./loader.ts";
export { createProgramCache } from "./cache.ts";
export type { ProgramCache } from "./cache.ts";
export { killAllRedirects, killRedirect, setRedirect } from "./modules.ts";
export { createHostObject, isDictionary, objectKeys } from "./objects.ts";
export { hostMethodDef, parseHostMethodDef } from "./host.ts";
export type { HostObjectContext, HostObjectType, HostRemoveResult, HostWriteResult } from "./host.ts";
export {
  createVmState,
  endBoardThreads,
  endItemThreads,
  findBlockingThread,
  hasLiveBlockingThread,
  scriptOwnsInput,
  findThread,
  cellRef,
  globalRef,
  incrementStepCounter,
  killThread,
  localRef,
  virtualRef,
  nextThreadId,
  readStepCounters,
  refreshBlock,
  startProgram,
  startThread,
} from "./state.ts";
export type {
  CollectedMove,
  ErrorHandler,
  Frame,
  GlobalBlock,
  LocalSlot,
  ObjectRecord,
  PendingCall,
  QueuedInline,
  Thread,
  ThreadInit,
  ThreadKind,
  ThreadOwner,
  ThreadStatus,
  VmState,
} from "./state.ts";
export {
  compareEqual,
  compareRelational,
  indexKey,
  isCallableValue,
  numberToString,
  stringToNumber,
  toInt32,
  toNumberValue,
  toStringValue,
  truthy,
} from "./values.ts";
export { CORE_PLUGIN } from "./builtins.ts";
export { ENGINE_PLUGIN_TABLE } from "./engine-plugins.ts";
export { FIRST_PARTY_PLUGINS } from "./first-party-plugins.ts";
export { RENDER_PLUGIN } from "./packs/render.ts";
export { UI_COMMANDS, UI_PLUGIN, applyUiEffect } from "./packs/ui.ts";
export { GRAPHICS_COMMANDS, GRAPHICS_PLUGIN } from "./packs/graphics.ts";
export { WORLD_PLUGIN } from "./packs/world.ts";
export { STOCK_RPG_PLUGIN } from "./stock-rpg.ts";
export { MOVEMENT_COMMANDS, MOVEMENT_PLUGIN, applyInputEffect, applySpriteEffect } from "./packs/movement.ts";
export { BATTLE_COMMANDS, BATTLE_COMMAND_NAMES, BATTLE_PLUGIN } from "./packs/battle.ts";
export { MEDIA_PLUGIN } from "./packs/media.ts";
export type { Arg, BuiltinDoc, BuiltinSpec, DocExample, DocReturns, DocTag, DocThrow, DocWait, ParamDoc, ParamDocValue, ParamSpec, RunnerSupport } from "./builtins.ts";
export {
  commandDocumentation,
  validateCommandDocumentation,
} from "./command-docs.ts";
export type {
  CommandDocumentation,
  CommandDocumentationDiagnostic,
  CommandParamDocumentation,
  NativeCommandRow,
  PluginDocumentation,
} from "./command-docs.ts";
export { CATALOGUE_PLUGIN, CATALOGUE_RESPONDERS_PLUGIN } from "./catalogue-responders.ts";
export { CATALOGUE_STUBS_PLUGIN } from "./catalogue-stubs.ts";
export { drainEffects, EFFECT_LOG_CAP, recordDiagnostic, recordEffect } from "./effects.ts";
export type {
  EffectKind,
  EffectPatch,
  EffectPatchOp,
  EffectRecord,
} from "./effects.ts";
export type {
  BehaviourRegistrar,
  CommandContinuation,
  CommandEffect,
  CommandHandler,
  CommandRequest,
  CommandResult,
  CommandView,
  MenuProvider,
  MenuProviderContext,
  MenuProviderEvent,
  MenuProviderInput,
  MenuProviderResult,
  PackageCatalogueEntry,
  PluginDefinition,
  PluginDoc,
  ResolvedPackageMetadata,
  ResolvedPlugin,
} from "./plugin.ts";
export type {
  HostRequestKind,
  PackageDeclaration,
  PluginManifest,
  PluginManifestDiagnostic,
  PluginManifestEntry,
  PluginManifestOperation,
  PluginManifestParseResult,
  PluginManifestPatch,
  PluginManifestPatchResult,
} from "./manifest.ts";
export {
  applyPluginManifestPatch,
  DEFAULT_PLUGIN_MANIFEST,
  ENGINE_DEFAULT_MANIFEST,
  HOST_REQUEST_KINDS,
  isPackageManifestEntry,
  PACKAGE_IDENTIFIER,
  isPluginManifestEntryEnabled,
  listPackageDeclarations,
  packageNamespace,
  parsePluginManifest,
} from "./manifest.ts";
export {
  assembleCommands,
  createCommandLookup,
  resolveCall,
  resolveNamespaced,
} from "./registry.ts";
export type {
  LegacyPluginEntry,
  LegacyPluginStatus,
} from "./legacy-plugins.ts";
export {
  FILEREADWRITE_PLUGIN,
  getDeclinedPluginDiagnostic,
  GSMISC_PLUGIN,
  KAIMU_PLUGIN,
  LEGACY_PLUGIN_TABLE,
  lookupLegacyPlugin,
  NATIVE_PACK_TABLE,
  NATIVE_PACKS,
  PROPLUG_PLUGIN,
  TRIUKEN_PLUGIN,
  TWBUTTON_PLUGIN,
  XFMWIN_PLUGIN,
} from "./legacy-plugins.ts";
export type {
  CallResolution,
  CommandLookup,
  CommandRegistry,
  CommandSource,
  FunctionTarget,
  NamespaceSource,
  ResolvedCommand,
} from "./registry.ts";
export {
  advanceScriptTick,
  collectGarbage,
  drainDiagnostics,
  discardMenuFrames,
  createScriptServices,
  replyToRequest,
  runThreadsPhase,
  runWaitsPhase,
  STEP_BUDGET,
  stepThread,
} from "./vm.ts";
export type { PackageStartupLifecycle } from "./vm.ts";
export { clearPluginLayers, createPluginLayers, layerRoots } from "./layers.ts";
export type { PluginLayers } from "./layers.ts";
export { runPackageStartup } from "./package-startup.ts";
export {
  createWaitPoll,
  defaultWaitPoll,
  describeWait,
  pollInputKey,
  pollMovement,
  pollRequest,
  pollSleep,
  pollAudioTrack,
  pollRenderMsgBox,
  REQUEST_TIMEOUT_TEXT,
  UI_WAIT_KIND_RESOLVERS,
  WAIT_KIND_RESOLVERS,
} from "./waits.ts";
export type { ScriptServices, ScriptStatus } from "./vm.ts";
export type { ScriptObservers, CallObservation, HandlerObservation } from "./observers.ts";
export { createDefaultVirtuals } from "./virtuals.ts";
export type { VirtualVariablePort, VirtualWriteResult } from "./virtuals.ts";
export { STRING_SPECS } from "./builtins/strings.ts";
export { CONVERSION_SPECS } from "./builtins/conversions.ts";
export { SCOPE_SPECS } from "./builtins/scope.ts";
export { THREAD_SPECS } from "./builtins/threads.ts";
export { ERROR_SPECS } from "./builtins/errors.ts";
export { FILE_SPECS } from "./builtins/files.ts";
export { PURE_SPECS } from "./builtins/pure.ts";
export { createCollectingSink, createLogger, LOG_LEVELS, NULL_LOGGER } from "./logging.ts";
export { HOST_METHOD_NAMES } from "./host-methods.ts";
