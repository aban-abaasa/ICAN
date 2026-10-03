/**
 * lucide-react, with the spinner icons swapped for the IcanEra diamond.
 *
 * vite.config.js aliases the bare `lucide-react` import to this file, so every
 * `<Loader2 className="animate-spin" />` in the app — and any added later —
 * shows the turning diamond without touching its call site. Everything else is
 * re-exported untouched from the real package (imported by subpath so the
 * alias does not loop back here). RefreshCw / RotateCw stay as they are: they
 * are action icons, not loaders.
 *
 * An explicit export takes precedence over `export *`, which is what makes the
 * overrides below win.
 */
export * from 'lucide-react/dist/esm/lucide-react.js';
export {
  DiamondSpinner as Loader,
  DiamondSpinner as LoaderIcon,
  DiamondSpinner as LucideLoader,
  DiamondSpinner as Loader2,
  DiamondSpinner as Loader2Icon,
  DiamondSpinner as LucideLoader2,
  DiamondSpinner as LoaderCircle,
  DiamondSpinner as LoaderCircleIcon,
  DiamondSpinner as LucideLoaderCircle,
} from '../components/IcanDiamond.jsx';
