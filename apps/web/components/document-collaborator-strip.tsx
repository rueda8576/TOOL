import { getCollaboratorTextColor, type CollaboratorPresence } from "../lib/documents-collaboration";

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
            color: getCollaboratorTextColor(collaborator.color)
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
