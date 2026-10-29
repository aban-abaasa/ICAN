import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Loader, Minus, Plus } from 'lucide-react';
import { getAvailableSlots } from '../../services/siteBookingService';
import { addDays, formatSlotTime, localISODate, nextDays, nightsBetween } from '../../utils/siteBooking';

/**
 * The three ways to pick when a service happens, themed for the business website (nb-* classes). Each reports the visitor's
 * pick through onSelect (null until there is a valid one) and re-reads availability whenever `refreshKey` changes, so a slot
 * that was just taken disappears for them too.
 *   SlotPicker   - a day strip and a grid of times      -> { date, slotStart, slotEnd }
 *   TicketPicker - a day strip and "how many"           -> { date, quantity }
 *   RoomPicker   - check-in / check-out and "how many"  -> { checkin, checkout, quantity }
 * A full slot or sold-out day is never blocked: it wears a badge and goes through as a request the business confirms by chat.
 */

// Once a day is sold out there is no real ceiling for the stepper (it is a request the business reviews): just a sane bound.
const UNBOUNDED_MAX = 20;

const DAY_BASE = 'flex-shrink-0 flex flex-col items-center rounded-xl border px-3.5 py-2 text-xs transition-all duration-200';
const DAY_ON = 'nb-btn-primary border-transparent scale-105 shadow-md';
const DAY_OFF = 'nb-surface-alt nb-border nb-text-muted hover:-translate-y-0.5';

const useAvailability = (productId, load, deps) => {
  const [state, setState] = useState({ loading: false, error: '' });
  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    setState({ loading: true, error: '' });
    load()
      .catch((err) => { if (active) setState({ loading: false, error: err.message || 'Could not load availability' }); })
      .then(() => { if (active) setState((s) => (s.error ? s : { loading: false, error: '' })); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, ...deps]);
  return state;
};

const Loading = ({ text }) => (
  <div className="flex items-center gap-2 py-3 text-sm nb-text-faint"><Loader className="w-3.5 h-3.5 animate-spin" />{text}</div>
);

const DayStrip = ({ days, value, onChange }) => (
  <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" role="listbox" aria-label="Pick a day">
    {days.map((d) => {
      const iso = localISODate(d);
      return (
        <button key={iso} type="button" role="option" aria-selected={iso === value} onClick={() => onChange(iso)} className={`${DAY_BASE} ${iso === value ? DAY_ON : DAY_OFF}`}>
          <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <span className="font-bold text-sm">{d.getDate()}</span>
          <span className="text-[10px] opacity-75">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
        </button>
      );
    })}
  </div>
);

const Stepper = ({ value, max, onChange, label }) => (
  <div className="flex items-center gap-2" role="group" aria-label={label}>
    <button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Fewer" className="h-8 w-8 rounded-lg nb-btn-secondary flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
    <span className="w-6 text-center text-sm font-bold nb-text" aria-live="polite">{value}</span>
    <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="More" className="h-8 w-8 rounded-lg nb-btn-secondary flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
  </div>
);

const SoldOutNote = ({ children }) => (
  <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-rose-300/60 bg-rose-500/10 px-2.5 py-1.5">
    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">{children}</span>
    <span className="text-[11px] nb-text-muted">Request anyway: the business confirms by chat.</span>
  </div>
);

export const SlotPicker = ({ productId, refreshKey, onSelect, selected }) => {
  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(localISODate(days[0]));
  const [slots, setSlots] = useState([]);
  const { loading, error } = useAvailability(productId, async () => setSlots(await getAvailableSlots(productId, date)), [date, refreshKey]);

  return (
    <div>
      <DayStrip days={days} value={date} onChange={setDate} />
      {loading && <Loading text="Loading available times…" />}
      {error && <p className="text-sm text-rose-500 py-3" role="alert">{error}</p>}
      {!loading && !error && slots.length === 0 && <p className="text-sm nb-text-faint py-3">Not open this day. Try another date.</p>}
      {!loading && slots.length > 0 && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-2">
            {slots.map((s) => {
              const on = selected?.date === date && selected?.slotStart === s.slot_start;
              const full = s.spots_left === 0;
              return (
                <button
                  key={s.slot_start}
                  type="button"
                  onClick={() => onSelect({ date, slotStart: s.slot_start, slotEnd: s.slot_end })}
                  className={`relative rounded-lg border px-2 py-2 text-xs font-semibold transition-all duration-200 ${on ? DAY_ON : full ? 'nb-surface-alt border-dashed nb-border nb-text-faint' : DAY_OFF}`}
                >
                  {full && <span className="absolute -top-2 -right-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">Full</span>}
                  {!full && s.spots_left <= 3 && <span className="absolute -top-2 -right-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-900 shadow-sm">{s.spots_left} left</span>}
                  {formatSlotTime(s.slot_start)}
                </button>
              );
            })}
          </div>
          <p className="flex items-center gap-1 pt-2 text-[11px] nb-text-faint"><Clock className="w-3 h-3" /> Full times can still be requested: the business confirms by chat.</p>
        </>
      )}
    </div>
  );
};

export const TicketPicker = ({ productId, refreshKey, onSelect, selected }) => {
  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(selected?.date || localISODate(days[0]));
  const [spotsLeft, setSpotsLeft] = useState(null);
  const [isOpenDay, setIsOpenDay] = useState(true);
  const [quantity, setQuantity] = useState(selected?.quantity || 1);
  const { loading, error } = useAvailability(productId, async () => {
    const data = await getAvailableSlots(productId, date);
    const left = data?.[0]?.spots_left ?? 0;
    setIsOpenDay((data?.length || 0) > 0);
    setSpotsLeft(left);
    setQuantity((q) => Math.max(1, Math.min(q, left > 0 ? left : UNBOUNDED_MAX)));
  }, [date, refreshKey]);

  useEffect(() => { onSelect(isOpenDay ? { date, quantity } : null); }, [date, quantity, isOpenDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const soldOut = isOpenDay && spotsLeft <= 0;
  return (
    <div>
      <DayStrip days={days} value={date} onChange={setDate} />
      {loading && <Loading text="Checking availability…" />}
      {error && <p className="text-sm text-rose-500 py-3" role="alert">{error}</p>}
      {!loading && !error && (!isOpenDay ? (
        <p className="text-sm nb-text-faint py-3">Not open this day. Try another date.</p>
      ) : (
        <div className="pt-2">
          {soldOut && <SoldOutNote>Sold out</SoldOutNote>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs nb-text-muted">{soldOut ? 'How many would you like to request?' : `${spotsLeft} ticket${spotsLeft === 1 ? '' : 's'} left for this date`}</span>
            <Stepper value={quantity} max={spotsLeft > 0 ? spotsLeft : UNBOUNDED_MAX} onChange={setQuantity} label="Number of tickets" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const RoomPicker = ({ productId, refreshKey, onSelect, selected }) => {
  const today = localISODate();
  const [checkin, setCheckin] = useState(selected?.checkin || today);
  const [checkout, setCheckout] = useState(selected?.checkout || addDays(today, 1));
  const [minAvailable, setMinAvailable] = useState(null);
  const [allNightsOpen, setAllNightsOpen] = useState(true);
  const [quantity, setQuantity] = useState(selected?.quantity || 1);
  const nights = nightsBetween(checkin, checkout);
  const { loading, error } = useAvailability(productId, async () => {
    if (nights < 1) { setMinAvailable(null); return; }
    // availability for a stay is the smallest "spots left" of any of its nights
    const perNight = await Promise.all(Array.from({ length: nights }, (_, i) => getAvailableSlots(productId, addDays(checkin, i))));
    const min = Math.min(...perNight.map((d) => d?.[0]?.spots_left ?? 0));
    setAllNightsOpen(perNight.every((d) => (d?.length || 0) > 0));
    setMinAvailable(min);
    setQuantity((q) => Math.max(1, Math.min(q, min > 0 ? min : UNBOUNDED_MAX)));
  }, [checkin, checkout, refreshKey]);

  useEffect(() => { onSelect(nights >= 1 && allNightsOpen ? { checkin, checkout, quantity } : null); }, [checkin, checkout, quantity, allNightsOpen, nights]); // eslint-disable-line react-hooks/exhaustive-deps

  const soldOut = allNightsOpen && minAvailable <= 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs nb-text-muted">Check-in
          <input type="date" value={checkin} min={today} onChange={(e) => { const v = e.target.value; if (!v) return; setCheckin(v); if (checkout <= v) setCheckout(addDays(v, 1)); }} className="mt-1 w-full rounded-lg nb-input px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs nb-text-muted">Check-out
          <input type="date" value={checkout} min={addDays(checkin, 1)} onChange={(e) => e.target.value && setCheckout(e.target.value)} className="mt-1 w-full rounded-lg nb-input px-2 py-1.5 text-sm" />
        </label>
      </div>
      {loading && <Loading text="Checking availability…" />}
      {error && <p className="text-sm text-rose-500" role="alert">{error}</p>}
      {!loading && !error && nights >= 1 && (!allNightsOpen ? (
        <p className="text-sm nb-text-faint">Not open for every night of that stay. Try different dates.</p>
      ) : (
        <div>
          {soldOut && <SoldOutNote>Fully booked</SoldOutNote>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs nb-text-muted">{soldOut ? 'How many rooms would you like to request?' : `${minAvailable} room${minAvailable === 1 ? '' : 's'} available for ${nights} night${nights === 1 ? '' : 's'}`}</span>
            <Stepper value={quantity} max={minAvailable > 0 ? minAvailable : UNBOUNDED_MAX} onChange={setQuantity} label="Number of rooms" />
          </div>
        </div>
      ))}
    </div>
  );
};
