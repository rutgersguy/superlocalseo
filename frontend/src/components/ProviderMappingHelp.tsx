import { useRef } from 'react';

export default function ProviderMappingHelp() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">How to map a location</button>
    <dialog ref={dialog} aria-labelledby="mapping-help-title" className="m-auto max-h-[85vh] w-[min(44rem,92vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 text-slate-800 shadow-card-md backdrop:bg-slate-900/50">
      <div className="flex items-start justify-between gap-4"><h2 id="mapping-help-title" className="text-xl font-semibold">Provider mapping guide</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="Close provider mapping guide" className="rounded border border-slate-300 px-3 py-1">Close</button></div>
      <p className="mt-4">A mapping connects one location in SuperLocalSEO to its review workspace in EmbedMyReviews (EMR). Getting this right keeps reviews and campaign destinations assigned to the correct customer and branch.</p>
      <h3 className="mt-5 font-semibold">The three IDs are different</h3>
      <dl className="mt-2 space-y-2 text-sm">
        <div><dt className="font-medium">EMR organization ID</dt><dd>The numeric ID of the customer's workspace. One customer may have several branches inside one organization. Different customers must not share an organization.</dd></div>
        <div><dt className="font-medium">EMR location ID</dt><dd>The numeric ID of the selected branch inside that workspace. Each SuperLocalSEO location needs its own provider location.</dd></div>
        <div><dt className="font-medium">Google Place ID</dt><dd>Google's identifier for the actual business listing, often starting with ChIJ. It is not either EMR number, the business name, a review ID or an address.</dd></div>
      </dl>
      <h3 className="mt-5 font-semibold">Before saving</h3>
      <ol className="mt-2 list-decimal space-y-3 pl-5 text-sm">
        <li>Confirm the customer and branch on this page. Compare the business name and address with the customer's onboarding details. Historical account IDs are clues, not proof of the intended branch.</li>
        <li>Open EMR, select that customer's organization and then the intended location. Inspect the attached Google source in Sources. Copy the organization/location IDs only from an explicit provider ID or confirmed internal setup record. If the UI does not show the numeric IDs, ask an administrator to retrieve them from the supported API; do not guess from names or URL fragments.</li>
        <li>Read the Google business name and exact Place ID from the attached source details. Compare the listing and address with the intended customer business. Copy the Place ID exactly. If it is unavailable or doesn't match, stop and ask for help.</li>
        <li>Enter the provider dashboard page URL, removing query parameters and fragments. Record the Google business name as displayed and the time you inspected it, within the last 30 minutes.</li>
        <li>Tick each confirmation only after checking it yourself. Add a useful note, such as: “Checked Downtown branch against the onboarding address and its attached Google source.” A generic “looks good” note is not enough context for the next operator.</li>
        <li>Save. The server checks organization/location membership and conflicts. Google business identity is recorded as your manual inspection; the API does not verify that part for you.</li>
      </ol>
      <h3 className="mt-5 font-semibold">Example — invented IDs</h3>
      <p className="mt-2 text-sm">A customer's Downtown and Northside branches could share organization 120, but use locations 301 and 302 respectively. Each branch must have its own exact Google Place ID and campaign destination. Never copy an example ID into a real record.</p>
      <h3 className="mt-5 font-semibold">Stop and ask an administrator when…</h3>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm"><li>The business, address or Place ID differs; several listings look similar; or you cannot establish ownership.</li><li>A provider ID is already assigned elsewhere, a saved Place ID differs, or the system says the record changed. Refresh and reconcile the discrepancy; do not work around the check with a different customer.</li><li>The attached source is missing or the provider cannot be checked. An empty source API result or a completed Google sign-in does not prove a usable connection.</li></ul>
      <p className="mt-4 text-sm">When no Place ID is saved, a successful inspection also saves the first ID. This form cannot overwrite a different saved ID. Changes to local business details require another inspection. A saved mapping does not prove review sync, campaign delivery or continued Google access.</p>
      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm">NerdBox / Light Hawk is an intentional review-testing fixture. Leave it unchanged unless the owner gives a specific testing instruction; do not use it as a real customer's mapping.</p>
      <button type="button" onClick={() => dialog.current?.close()} className="mt-5 rounded-lg bg-slate-800 px-4 py-2 text-white">Back to mappings</button>
    </dialog>
  </>;
}
