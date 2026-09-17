let openModals = 0;

/** Shared by viewport surfaces so closing one cannot clear another's update guard. */
export function publishModalState(open: boolean): void {
  openModals = Math.max(0, openModals + (open ? 1 : -1));
  if (openModals > 0) document.documentElement.dataset.hfModal = 'open';
  else delete document.documentElement.dataset.hfModal;
}
