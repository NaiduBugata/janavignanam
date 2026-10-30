import { useState, useMemo, useRef, useCallback } from "react";
import {
  ASSEMBLY_CONSTITUENCIES,
  MAP_VIEWBOX,
  MAP_OUTER_BORDER,
  MAP_INTERNAL_BORDER,
  MAP_COLORS,
  type AssemblyConstituency,
} from "./constituency-data";
import { RotateCcw, ZoomIn, ZoomOut, Check, Info } from "lucide-react";

interface ConstituencyMapProps {
  selectedAssembly: string;
  selectedDivision: string;
  assemblyCounts: Record<string, number>;
  totalAll: number;
  onSelectAssembly: (name: string) => void;
  onClearSelection: () => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  constituency: AssemblyConstituency | null;
}

export function ConstituencyMap({
  selectedAssembly,
  selectedDivision,
  assemblyCounts,
  totalAll,
  onSelectAssembly,
  onClearSelection,
}: ConstituencyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    constituency: null,
  });

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const activeNormalized = selectedAssembly.trim().toLowerCase();
  const divisionNormalized = selectedDivision.trim().toLowerCase();

  const handleMouseMove = useCallback((e: React.MouseEvent, c: AssemblyConstituency) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltip({
      visible: true,
      x,
      y,
      constituency: c,
    });
  }, []);

  const handleMouseEnter = useCallback((c: AssemblyConstituency) => {
    setHoveredId(c.id);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(Math.max(0.8, prev + delta), 2.5));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary button
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const selectedConstituency = useMemo(() => {
    if (!activeNormalized) return null;
    return ASSEMBLY_CONSTITUENCIES.find(
      (c) => c.name.toLowerCase() === activeNormalized
    ) || null;
  }, [activeNormalized]);

  return (
    <div className="relative flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition-all">
      {/* Map Header / Control Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Assembly Constituencies
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            · 7 Segments (Palnadu)
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClearSelection}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${
              !selectedAssembly
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All Constituencies
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Zoom controls */}
          <div className="inline-flex rounded-lg border bg-background p-0.5">
            <button
              type="button"
              onClick={() => handleZoom(0.2)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-0.2)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Reset Zoom"
              aria-label="Reset Zoom"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl bg-white border border-slate-100 flex items-center justify-center min-h-[360px] md:min-h-[460px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          viewBox={MAP_VIEWBOX.viewBox}
          className="w-full h-auto max-h-[540px] drop-shadow-sm transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
            transformOrigin: "center center",
          }}
        >
          {/* Subtle drop-shadow filters */}
          <defs>
            <filter id="active-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#1E3A8A" floodOpacity="0.45" />
            </filter>
            <filter id="hover-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#EA580C" floodOpacity="0.3" />
            </filter>
            {/* Clip path preventing any stroke from bleeding outside the district boundary */}
            <clipPath id="district-clip">
              <path d={MAP_OUTER_BORDER} />
            </clipPath>
          </defs>

          {/* Group 1: Regional Fills (Clipped inside the outer boundary with zero stroke) */}
          <g clipPath="url(#district-clip)">
            {ASSEMBLY_CONSTITUENCIES.map((c) => {
              const isSelected = activeNormalized === c.name.toLowerCase();
              const isHovered = hoveredId === c.id;
              const matchesDivision =
                !divisionNormalized ||
                divisionNormalized === "all divisions" ||
                c.division.toLowerCase() === divisionNormalized;

              // Opacity logic: unselected regions dim gracefully when a filter is active
              let opacity = 1;
              if (activeNormalized && !isSelected) {
                opacity = 0.45;
              } else if (divisionNormalized && !matchesDivision) {
                opacity = 0.35;
              }

              return (
                <path
                  key={c.id}
                  d={c.svgPath}
                  fill={c.color}
                  stroke="none"
                  style={{ opacity }}
                  className="cursor-pointer transition-opacity duration-200"
                  tabIndex={0}
                  role="button"
                  aria-label={`${c.name} Assembly Constituency, #${c.acNo}, ${c.division} Division, ${(assemblyCounts[c.name] || 0).toLocaleString()} contacts`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAssembly(c.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectAssembly(c.name);
                    }
                  }}
                  onMouseEnter={() => handleMouseEnter(c)}
                  onMouseMove={(e) => handleMouseMove(e, c)}
                  onMouseLeave={handleMouseLeave}
                />
              );
            })}

            {/* Selected Constituency Highlight Overlay */}
            {selectedConstituency && (
              <path
                d={selectedConstituency.svgPath}
                fill="#FEF3C7"
                fillOpacity={0.4}
                stroke="#1E3A8A"
                strokeWidth={3.5}
                strokeLinejoin="round"
                filter="url(#active-glow)"
                className="pointer-events-none"
              />
            )}

            {/* Internal Orange Borders (Single clean path between constituencies, NEVER on outer perimeter) */}
            <path
              d={MAP_INTERNAL_BORDER}
              fill="#FB6116"
              stroke="#FB6116"
              strokeWidth={0.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="pointer-events-none"
            />
          </g>

          {/* Group 2: Outer Perimeter Boundary (Solid dark charcoal stroke on top of all fills) */}
          <path
            d={MAP_OUTER_BORDER}
            fill="none"
            stroke={MAP_COLORS.outerBorder}
            strokeWidth={3.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none"
          />

          {/* Group 3: Text Labels Styled Exactly from Reference Map */}
          {ASSEMBLY_CONSTITUENCIES.map((c) => {
            const isSelected = activeNormalized === c.name.toLowerCase();
            const matchesDivision =
              !divisionNormalized ||
              divisionNormalized === "all divisions" ||
              c.division.toLowerCase() === divisionNormalized;

            let opacity = 1;
            if (activeNormalized && !isSelected) {
              opacity = 0.55;
            } else if (divisionNormalized && !matchesDivision) {
              opacity = 0.4;
            }

            return (
              <g
                key={`label-${c.id}`}
                transform={`translate(${c.labelPos[0]}, ${c.labelPos[1]})${c.rotation ? ` rotate(${c.rotation})` : ""}`}
                className="pointer-events-none select-none transition-opacity duration-200"
                style={{ opacity }}
              >
                {/* Active selection badge pill behind text */}
                {isSelected && (
                  <rect
                    x="-66"
                    y="-22"
                    width="132"
                    height="48"
                    rx="8"
                    fill="#1E3A8A"
                    fillOpacity={0.92}
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                    className="drop-shadow-md"
                  />
                )}

                {/* Constituency Name */}
                <text
                  x="0"
                  y="-2"
                  textAnchor="middle"
                  fill={isSelected ? "#FFFFFF" : MAP_COLORS.labelColor}
                  fontSize="18"
                  fontWeight="600"
                  fontFamily="Georgia, Cambria, 'Times New Roman', serif"
                  className="transition-colors"
                >
                  {c.name}
                </text>

                {/* Delimitation Segment Number */}
                <text
                  x="0"
                  y={isSelected ? "17" : "19"}
                  textAnchor="middle"
                  fill={isSelected ? "#FDE68A" : MAP_COLORS.labelColor}
                  fontSize="16"
                  fontWeight="500"
                  fontFamily="Georgia, Cambria, 'Times New Roman', serif"
                  className="tabular-nums transition-colors"
                >
                  {c.acNo}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {tooltip.visible && tooltip.constituency && (
          <div
            className="pointer-events-none absolute z-30 transform -translate-x-1/2 -translate-y-full mb-2 rounded-xl border bg-slate-900/95 px-3.5 py-2.5 text-xs text-white shadow-xl backdrop-blur-sm transition-all"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y - 12}px`,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full ring-1 ring-white/50"
                style={{ backgroundColor: tooltip.constituency.color }}
              />
              <span className="font-bold text-sm">{tooltip.constituency.name}</span>
              <span className="text-[11px] text-slate-300">
                ({tooltip.constituency.teluguName})
              </span>
            </div>

            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-amber-300">
                Segment #{tooltip.constituency.acNo}
              </span>
              <span>{tooltip.constituency.division} Division</span>
            </div>

            <div className="mt-2 border-t border-slate-700 pt-1.5 flex items-center justify-between gap-5 font-semibold text-emerald-400">
              <span>Verified Contacts:</span>
              <span className="tabular-nums">
                {(assemblyCounts[tooltip.constituency.name] || 0).toLocaleString()}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-400">Click to filter directory</p>
          </div>
        )}

        {/* Active Selection Overlay Indicator */}
        {selectedAssembly && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-card/95 border px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
            <Check className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Filtered to:</span>
            <span className="font-bold text-foreground">{selectedAssembly}</span>
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-1 text-[11px] text-primary hover:underline font-medium"
            >
              Show all
            </button>
          </div>
        )}
      </div>

      {/* Map Legend Pills (Clickable) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {ASSEMBLY_CONSTITUENCIES.map((c) => {
            const isSelected = activeNormalized === c.name.toLowerCase();
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectAssembly(c.name)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: c.color }}
                />
                <span className="font-medium">{c.name}</span>
                <span className="text-[10px] opacity-75 font-serif">({c.acNo})</span>
                <span
                  className={`tabular-nums text-[10px] rounded px-1 ${
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {(assemblyCounts[c.name] || 0).toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <span>7 Assembly Constituencies · Palnadu</span>
        </div>
      </div>
    </div>
  );
}
