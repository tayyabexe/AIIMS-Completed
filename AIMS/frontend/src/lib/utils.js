import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/*
 * The class-name helper every shadcn/21st.dev component imports.
 *
 * `clsx` flattens conditionals and arrays into a string; `twMerge` then
 * resolves Tailwind conflicts by *last wins per property group*, so a caller
 * passing `p-2` to a component whose base is `p-4` gets `p-2` rather than both
 * classes fighting in the cascade — where the winner would be whichever
 * Tailwind happened to emit later, not whichever the caller meant.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
