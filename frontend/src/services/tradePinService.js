import { confirmWalletPin } from './churchTitheService';
import { runPinCheck } from '../utils/tradePin';

// Every buy and sell asks for the IcanEra wallet PIN right before the money moves: the same masked PIN dialog and the same
// 3-wrong-tries lock as sending money or giving tithe. `askPin` is the function from usePinPrompt(). `message` says exactly
// what the PIN is approving. Resolves { ok: true } or { ok: false, cancelled, error }; it never throws.
export const confirmTradePin = (askPin, message) => runPinCheck((options) => confirmWalletPin(askPin, options), message);

export default confirmTradePin;
