// jsdom has no top layer. Browser smoke must prove actual modality/hit-testing.
export function stubNativeDialog() {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}
