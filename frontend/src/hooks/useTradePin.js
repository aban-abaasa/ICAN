import { useCallback } from 'react';
import { usePinPrompt } from '../components/PinPromptDialog';
import { confirmTradePin } from '../services/tradePinService';

// const { confirmPin, pinDialog } = useTradePin();
// const pin = await confirmPin('Buy about 29.01 ICEC-S for UGX 120,000.');   // { ok: true } or { ok: false, cancelled, error }
// if (!pin.ok) { ...show pin.error; do NOT trade... }
// ...and render {pinDialog} once in the screen. Ask AFTER the screen's busy flag is on, so a second tap cannot open a second prompt.
export const useTradePin = () => {
  const { askPin, pinDialog } = usePinPrompt();
  const confirmPin = useCallback((message) => confirmTradePin(askPin, message), [askPin]);
  return { confirmPin, pinDialog };
};

export default useTradePin;
