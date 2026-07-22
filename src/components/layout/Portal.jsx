import { createPortal } from 'react-dom';

// Renders children at the end of <body>, outside the page tree.
//
// Every hand-rolled `position: fixed` overlay (modal, bottom sheet, backdrop)
// MUST go through this. Any ancestor with a transform / will-change / filter
// creates a *containing block*, which traps and clips fixed descendants to that
// ancestor's box instead of the viewport — the overlay then renders as an
// invisible sliver instead of covering the screen. Framer-motion cards and the
// page-transition wrapper both do this, so rendering an overlay inline inside a
// page is never safe. (Radix primitives in components/ui already portal.)
export default function Portal({ children }) {
  return createPortal(children, document.body);
}
