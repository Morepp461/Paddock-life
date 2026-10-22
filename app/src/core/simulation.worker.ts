/// <reference lib="webworker" />
self.addEventListener("message", (event: MessageEvent<{ type: string; requestId: string }>) => {
  if (event.data?.type === "PING") self.postMessage({ type: "PONG", requestId: event.data.requestId, runtime: "worker" });
});
