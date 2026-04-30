import { useCallback, useEffect, useState } from "react";
import { AvatarCanvas } from "./components/AvatarCanvas";
import { PersonaSelector } from "./components/PersonaSelector";
import { SessionControls } from "./components/SessionControls";
import { Transcript } from "./components/Transcript";
import { VoiceInput } from "./components/VoiceInput";
import { LipSyncDiagnostics } from "./components/LipSyncDiagnostics";
import { ThemeToggle } from "./components/ThemeToggle";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { useSession } from "./hooks/useSession";
import { useTheme } from "./hooks/useTheme";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSessionStore } from "./store/sessionStore";
import { useAvatarStore } from "./store/avatarStore";

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
  const capabilities = useSessionStore((s) => s.capabilities);

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
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const { theme, toggleTheme } = useTheme();

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
      // Diagnostics: record chunk metadata as soon as it arrives (playback may start later).
      const receivedAt = performance.now();
      useAvatarStore.getState().setLastChunkMeta({
        sentenceIndex: chunk.sentenceIndex,
        isSilence: !!chunk.isSilence,
        visemeSource: chunk.visemeSource ?? null,
        receivedAt,
      });

      // Start viseme timeline immediately for responsiveness (mouth moves right away),
      // then `useAudioPlayback` will re-align `chunkStartedAt` to the real audio start.
      if (chunk.visemes?.length) {
        useAvatarStore.getState().setVisemeTrack(chunk.visemes, receivedAt, {
          sentenceIndex: chunk.sentenceIndex,
          isSilence: !!chunk.isSilence,
          visemeSource: chunk.visemeSource ?? null,
          receivedAt,
        });
      }
      enqueue({
        audioBase64: chunk.audioBase64,
        audioMimeType: chunk.audioMimeType,
        visemes: chunk.visemes,
        visemeSource: chunk.visemeSource,
        isLast: chunk.isLast,
        sentenceIndex: chunk.sentenceIndex,
        text: chunk.text,
        isSilence: chunk.isSilence,
        receivedAt,
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
    <div className="app-shell flex flex-col">
      <header className="topbar px-4 py-4 md:px-8">
        <div className="container-app flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-2xl font-bold tracking-tight">Proxim</p>
            <p className="text-sm text-muted">Real-time AI HCP roleplay for pharmaceutical sales training</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <SessionControls
              active={isSessionActive}
              elapsedSec={elapsedSec}
              canStart={!!personaId && !isSessionActive}
              onStart={handleStart}
              onEnd={handleEnd}
            />
          </div>
        </div>
      </header>

      <main className="container-app flex flex-1 flex-col gap-6 py-6 md:flex-row">
        <section className="flex flex-1 flex-col gap-4">
          {!isSessionActive ? (
            <>
              <h2 className="font-display text-lg font-semibold">Choose an HCP persona</h2>
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
                  <p className="kicker">Active persona</p>
                  <p className="font-display text-lg font-semibold">
                    {selectedPersona?.name}{" "}
                    <span className="text-sm font-normal text-muted">
                      · {selectedPersona?.specialty}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="btn px-3 py-1.5 text-xs md:hidden"
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
                <p className="panel border border-border px-4 py-2 text-sm" style={{ borderColor: "rgba(245, 158, 11, 0.45)" }}>
                  {micError}
                </p>
              ) : null}

              {!audioUnlocked ? (
                <p className="text-xs text-muted">
                  Audio unlocks when you start a session (required on mobile browsers).
                </p>
              ) : null}

              <p className="text-xs text-muted">
                WebSocket: {connected ? "connected" : "disconnected"}
                {capabilities.alignmentAvailable != null ? (
                  <>
                    {" "}
                    · Lip-sync: {capabilities.alignmentAvailable ? "alignment" : "fallback"}
                  </>
                ) : null}
                {capabilities.elevenLabsConfigured != null && capabilities.groqConfigured != null ? (
                  <>
                    {" "}
                    · TTS:{" "}
                    {capabilities.elevenLabsConfigured ? "ElevenLabs" : null}
                    {capabilities.elevenLabsConfigured && capabilities.groqConfigured ? " + " : null}
                    {capabilities.groqConfigured ? "Groq" : null}
                    {!capabilities.elevenLabsConfigured && !capabilities.groqConfigured ? "none" : null}
                  </>
                ) : null}{" "}
                · Silence threshold 1.5s before sending to the model.
              </p>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowDiagnostics((v) => !v)}
                  className="btn px-3 py-1.5 text-xs"
                >
                  {showDiagnostics ? "Hide lip-sync diagnostics" : "Show lip-sync diagnostics"}
                </button>
              </div>

              {showDiagnostics ? <LipSyncDiagnostics /> : null}
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

      <footer className="border-t border-border px-4 py-4 text-center text-[11px] text-muted">
        Proxim · Conversation AI Hackathon 2026 · MIT License
      </footer>
    </div>
  );
}
