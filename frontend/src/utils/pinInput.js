// Wallet PINs are 4 to 6 digits (the wallet's own PIN pad says so). Every PIN box should clean
// what is typed the same way, so a pasted "12 34-56" still works and a letter never gets in.
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export const cleanPin = (value) => String(value ?? '').replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);

export const isValidPin = (pin) => {
  const p = String(pin ?? '');
  return p.length >= PIN_MIN_LENGTH && p.length <= PIN_MAX_LENGTH && /^\d+$/.test(p);
};
