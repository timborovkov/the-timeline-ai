/**
 * React 19 function form actions set `action="javascript:throw …"` as a
 * placeholder and intercept the submit event. happy-dom's `requestSubmit()`
 * still navigates that URL when the event is not preventDefaulted, which
 * React 19.3 no longer always does in this test environment. Dispatch the
 * submit event without following the placeholder action so form actions run.
 */
if (typeof HTMLFormElement !== 'undefined') {
  HTMLFormElement.prototype.requestSubmit = function requestSubmit(submitter?: HTMLElement) {
    const eventInit: EventInit & { submitter?: HTMLElement } = {
      bubbles: true,
      cancelable: true,
    };
    if (submitter) eventInit.submitter = submitter;
    const event =
      typeof SubmitEvent === 'function'
        ? new SubmitEvent('submit', eventInit)
        : new Event('submit', eventInit);
    this.dispatchEvent(event);
  };
}
