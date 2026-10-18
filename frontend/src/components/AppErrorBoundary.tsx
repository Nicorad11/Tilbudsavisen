import { RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/monitoring';
import { isChunkLoadError, reloadForNewVersion } from '../lib/updates';

/**
 * Sidste sikkerhedsnet: en fejl i en side giver en venlig besked med
 * "Genindlæs" i stedet for en tom skærm. Mangler en kodefil efter en ny
 * version, genindlæses siden med det samme.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error) && reloadForNewVersion()) return;
    reportError(error, info.componentStack ?? undefined);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const newVersion = isChunkLoadError(this.state.error);
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-4">
        <div className="card max-w-sm p-6 text-center">
          <p className="text-lg tracking-tight text-ink">{newVersion ? 'Der er kommet en ny version' : 'Noget gik galt'}</p>
          <p className="mt-2 text-[14px] leading-snug text-muted">
            {newVersion
              ? 'Tilbudsradar er blevet opdateret, mens siden var åben. Genindlæs for at hente den nye version.'
              : 'Siden kunne ikke vises. Prøv at genindlæse – fejlen er sendt til os.'}
          </p>
          <button
            type="button"
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="size-4" /> Genindlæs siden
          </button>
        </div>
      </div>
    );
  }
}
