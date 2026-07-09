/** An animated "typing" indicator (three bouncing dots) shown while Scout thinks. */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Scout is thinking">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}
