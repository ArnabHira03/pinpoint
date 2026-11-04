import "@testing-library/jest-dom/vitest";

// jsdom lacks <dialog> modal support.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

// jsdom does not implement scrolling.
Element.prototype.scrollIntoView ??= function () {};
