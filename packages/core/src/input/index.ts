export {
  applyInputEvent,
  applySemanticActionEdge,
  configureInput,
  createInputSection,
  inputView,
  processGamepadEvents,
  pruneClaimed,
  claimInputBefore,
  registeredActionNames,
  rebuildKeyboardActionClaimIndex,
  rebuildKeyboardKeyClaimIndex,
  registerGameAction,
  recomputeInputActions,
  takeInputActions,
  heldPointerGoal,
  setPointerMovementSuppressed,
} from "./input.ts";
export type { InputAction, InputConfig, InputKey, InputView } from "./input.ts";
export { inputPhaseRegistration, inputResetRegistration, openMainMenu, routePointerUpActivations, runInputPhase } from "./registration.ts";
export type { InputPhaseOptions } from "./registration.ts";
