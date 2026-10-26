import { divisionNames, mandalNames, villageNames } from "@/places.ts";

export type PlaceFilter = { division: string; mandal: string; village: string };

export const emptyPlace: PlaceFilter = { division: "", mandal: "", village: "" };

const selectClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

export function PlaceFilters({ value, onChange }: { value: PlaceFilter; onChange: (next: PlaceFilter) => void }) {
  const mandals = value.division ? mandalNames(value.division) : [];
  const villages = value.division && value.mandal ? villageNames(value.division, value.mandal) : [];

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Division</span>
        <select value={value.division} onChange={(event) => onChange({ division: event.target.value, mandal: "", village: "" })} className={selectClass}>
          <option value="">All divisions</option>
          {divisionNames().map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Mandal</span>
        <select value={value.mandal} onChange={(event) => onChange({ ...value, mandal: event.target.value, village: "" })} disabled={!value.division} className={selectClass}>
          <option value="">All mandals</option>
          {mandals.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Village</span>
        <select value={value.village} onChange={(event) => onChange({ ...value, village: event.target.value })} disabled={!value.mandal} className={selectClass}>
          <option value="">All villages</option>
          {villages.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
