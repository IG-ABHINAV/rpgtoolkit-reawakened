export {
  applyInputEvent,
  configureInput,
  createInputSection,
  inputView,
  processGamepadEvents,
  claimInputBefore,
  pruneClaimed,
  takeInputActions,
} from "./input.ts";
export type { InputAction, InputConfig, InputKey, InputView } from "./input.ts";
export { inputPhaseRegistration, inputResetRegistration, openMainMenu, runInputPhase } from "./registration.ts";
export type { InputPhaseOptions } from "./registration.ts";
