// A small, always-visible marker that the user is on the staging/test
// environment (synthetic data, may be reset). Mounted app-wide on staging only.
export default function StagingBadge() {
  return (
    <div
      className="fixed bottom-3 left-3 z-40 select-none rounded-full border border-amber-300 bg-amber-100/95 px-3 py-1 text-[11px] font-semibold text-amber-800 shadow-sm backdrop-blur"
      title="This is the staging test environment. Use synthetic data only; it may be reset without notice."
    >
      TEST ENVIRONMENT · synthetic data only
    </div>
  );
}
