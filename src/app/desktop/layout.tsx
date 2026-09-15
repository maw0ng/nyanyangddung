/**
 * Scoped transparency override for Desktop Mode only. globals.css sets
 * `body { background: #111318 }` for the Avatar Editor's dark theme -
 * that rule is left completely untouched (section 4: "Avatar Editor에는
 * 영향을 주지 않으면서"). This <style> tag's `!important` rule only
 * exists in the DOM while a /desktop page is mounted, and is removed the
 * moment the user navigates away, so every other route is unaffected.
 */
export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        html, body {
          background: transparent !important;
        }
      `}</style>
      {children}
    </>
  );
}
