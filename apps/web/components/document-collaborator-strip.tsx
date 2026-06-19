import type { CollaboratorPresence } from "../lib/documents-collaboration";

function hslToRgb(color: string): { r: number; g: number; b: number } | null {
  const match = color.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i);
  if (!match) {
    return null;
  }

  const hue = Number(match[1]);
  const saturation = Number(match[2]) / 100;
  const lightness = Number(match[3]) / 100;
  if (!Number.isFinite(hue) || !Number.isFinite(saturation) || !Number.isFinite(lightness)) {
    return null;
  }

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const matchLightness = lightness - chroma / 2;

  const [red, green, blue] =
    huePrime < 1 ? [chroma, secondary, 0] :
    huePrime < 2 ? [secondary, chroma, 0] :
    huePrime < 3 ? [0, chroma, secondary] :
    huePrime < 4 ? [0, secondary, chroma] :
    huePrime < 5 ? [secondary, 0, chroma] :
    [chroma, 0, secondary];

  return {
    r: Math.round((red + matchLightness) * 255),
    g: Math.round((green + matchLightness) * 255),
    b: Math.round((blue + matchLightness) * 255)
  };
}

function relativeLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function collaboratorTextColor(backgroundColor: string): string {
  const rgb = hslToRgb(backgroundColor);
  if (!rgb) {
    return "#ffffff";
  }

  const luminance =
    0.2126 * relativeLuminance(rgb.r) +
    0.7152 * relativeLuminance(rgb.g) +
    0.0722 * relativeLuminance(rgb.b);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const graphiteContrast = (luminance + 0.05) / 0.05;
  return graphiteContrast >= whiteContrast ? "#111827" : "#ffffff";
}

export function DocumentCollaboratorStrip({
  hiddenCollaboratorsCount,
  isRealtimeConnected,
  realtimeStatusNote,
  visibleCollaborators
}: {
  hiddenCollaboratorsCount: number;
  isRealtimeConnected: boolean;
  realtimeStatusNote: string | null;
  visibleCollaborators: CollaboratorPresence[];
}): JSX.Element {
  return (
    <div className="documents-collaborators" aria-live="polite" aria-label="Collaborators in this document">
      {visibleCollaborators.map((collaborator) => (
        <span
          key={`${collaborator.id}-${collaborator.clientId}`}
          className={collaborator.isSelf ? "documents-collaborator-pill documents-collaborator-pill-self" : "documents-collaborator-pill"}
          style={{
            backgroundColor: collaborator.color,
            borderColor: collaborator.color,
            color: collaboratorTextColor(collaborator.color)
          }}
          title={
            collaborator.activePath
              ? `${collaborator.name} editing ${collaborator.activePath}`
              : `${collaborator.name} viewing`
          }
        >
          {collaborator.initials}
        </span>
      ))}
      {hiddenCollaboratorsCount > 0 ? (
        <span className="documents-collaborator-more" title={`${hiddenCollaboratorsCount} more collaborators`}>
          +{hiddenCollaboratorsCount}
        </span>
      ) : null}
      <span className={isRealtimeConnected ? "documents-realtime-status documents-realtime-status-live" : "documents-realtime-status"}>
        {isRealtimeConnected ? "Live" : "Offline"}
      </span>
      {realtimeStatusNote ? <span className="documents-realtime-note">{realtimeStatusNote}</span> : null}
    </div>
  );
}
