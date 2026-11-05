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
  registerGameAction,
  takeInputActions,
  heldPointerGoal,
  setPointerMovementSuppressed,
} from "./input.ts";
export type { InputAction, InputConfig, InputKey, InputView } from "./input.ts";
export { inputPhaseRegistration, inputResetRegistration, openMainMenu, runInputPhase } from "./registration.ts";
export type { InputPhaseOptions } from "./registration.ts";
