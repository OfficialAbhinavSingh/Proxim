import { useCallback, useEffect, useState } from "react";
import { AvatarCanvas } from "./components/AvatarCanvas";
import { PersonaSelector } from "./components/PersonaSelector";
import { SessionControls } from "./components/SessionControls";
import { Transcript } from "./components/Transcript";
import { VoiceInput } from "./components/VoiceInput";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { useSession } from "./hooks/useSession";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSessionStore } from "./store/sessionStore";

export default function App() {
  const {
    personas,
    personaId,
    setPersonaId,
    selectedPersona,
    sessionId,
    isSessionActive,
    elapsedSec,
    startSession,
    endSession,
    appendUserMessage,
    completeAssistantTurn,
    assistantStreamingText,
    messages,
  } = useSession();

  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar);
  const setMicError = useSessionStore((s) => s.setMicError);
  const micError = useSessionStore((s) => s.micError);
  const audioUnlocked = useSessionStore((s) => s.audioUnlocked);
  const setAudioUnlocked = useSessionStore((s) => s.setAudioUnlocked);

  const {
    connected,
    connect,
    disconnect,
    send,
    setOnAudioChunk,
    setOnTranscriptUpdate,
    setOnError,
  } = useWebSocket();

  const [awaitingWsStart, setAwaitingWsStart] = useState(false);

  const { enqueue, ensureCtx } = useAudioPlayback(() => {
    completeAssistantTurn();
  });

  const handleUserText = useCallback(
    (text: string) => {
      if (!sessionId || !personaId || !text.trim()) return;
      appendUserMessage(text.trim());
      send({
        type: "user_input",
        text: text.trim(),
        sessionId,
        personaId,
      });
    },
    [appendUserMessage, personaId, send, sessionId]
  );

  const { listening, partialTranscript, mode, startListening, stopListening, tapToSpeak } =
    useVoiceInput({
      enabled: isSessionActive && audioUnlocked,
      onUtterance: handleUserText,
      onError: (m) => setMicError(m),
    });

  useEffect(() => {
    setOnAudioChunk((chunk) => {
      enqueue({
        audioBase64: chunk.audioBase64,
        audioMimeType: chunk.audioMimeType,
        visemes: chunk.visemes,
        isLast: chunk.isLast,
        sentenceIndex: chunk.sentenceIndex,
        text: chunk.text,
        isSilence: chunk.isSilence,
      });
    });
    setOnTranscriptUpdate(() => {
      /* streaming text handled in store via useWebSocket */
    });
    setOnError((m) => setMicError(m));
  }, [enqueue, setOnAudioChunk, setOnError, setOnTranscriptUpdate]);

  useEffect(() => {
    if (!awaitingWsStart || !connected) return;
    const sid = useSessionStore.getState().sessionId;
    const pid = useSessionStore.getState().personaId;
    if (sid && pid) send({ type: "session_start", sessionId: sid, personaId: pid });
    setAwaitingWsStart(false);
  }, [awaitingWsStart, connected, personaId, send]);

  const handleStart = async () => {
    if (!personaId) return;
    setMicError(null);
    await ensureCtx();
    setAudioUnlocked(true);
    startSession();
    setAwaitingWsStart(true);
    connect();
    void startListening();
  };

  const handleEnd = () => {
    const sid = sessionId;
    if (sid) send({ type: "session_end", sessionId: sid });
    stopListening();
    disconnect();
    endSession();
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="flex min-h-screen flex-col bg-proxim-950 text-slate-100">
      <header className="border-b border-white/10 bg-proxim-900/40 px-4 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-2xl font-bold tracking-tight text-white">Proxim</p>
            <p className="text-sm text-slate-400">
              Real-time AI HCP roleplay for pharmaceutical sales training
            </p>
          </div>
          <SessionControls
            active={isSessionActive}
            elapsedSec={elapsedSec}
            canStart={!!personaId && !isSessionActive}
            onStart={handleStart}
            onEnd={handleEnd}
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row md:px-8">
        <section className="flex flex-1 flex-col gap-4">
          {!isSessionActive ? (
            <>
              <h2 className="font-display text-lg font-semibold text-white">Choose an HCP persona</h2>
              <PersonaSelector
                personas={personas}
                selectedId={personaId}
                onSelect={setPersonaId}
                disabled={false}
              />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Active persona</p>
                  <p className="font-display text-lg font-semibold text-white">
                    {selectedPersona?.name}{" "}
                    <span className="text-sm font-normal text-slate-400">
                      · {selectedPersona?.specialty}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="rounded-lg border border-white/10 bg-proxim-900 px-3 py-1.5 text-xs text-slate-300 hover:bg-proxim-800 md:hidden"
                >
                  {sidebarOpen ? "Hide chat" : "Show chat"}
                </button>
              </div>

              <AvatarCanvas avatarUrl={selectedPersona?.avatarUrl ?? ""} />

              <VoiceInput
                partialTranscript={partialTranscript}
                listening={listening}
                mode={mode}
                onTapToSpeak={() => void tapToSpeak()}
              />

              {micError ? (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
                  {micError}
                </p>
              ) : null}

              {!audioUnlocked ? (
                <p className="text-xs text-slate-500">
                  Audio unlocks when you start a session (required on mobile browsers).
                </p>
              ) : null}

              <p className="text-xs text-slate-500">
                WebSocket: {connected ? "connected" : "disconnected"} · Silence threshold 1.5s before
                sending to the model.
              </p>
            </>
          )}
        </section>

        {isSessionActive ? (
          <Transcript
            open={sidebarOpen}
            onToggle={toggleSidebar}
            messages={messages}
            streamingAssistant={assistantStreamingText}
          />
        ) : null}
      </main>

      <footer className="border-t border-white/10 px-4 py-4 text-center text-[11px] text-slate-600">
        Proxim · Conversation AI Hackathon 2026 · MIT License
      </footer>
    </div>
  );
}
