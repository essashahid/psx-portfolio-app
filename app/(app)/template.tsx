// A template (unlike layout) remounts on every navigation, so its children
// replay the enter animation each time — giving every page a quick, consistent
// fade-in instead of a hard pop. Kept subtle (150ms) so it never adds felt latency.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
