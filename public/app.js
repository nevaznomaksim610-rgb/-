const button = document.querySelector("#microphoneButton");
const liveStatus = document.querySelector("#liveStatus");
const remoteAudio = document.querySelector("#remoteAudio");

let peer = null;
let events = null;
let microphone = null;
let ready = false;
let finalized = false;
let closeTimeout = null;
let maxSessionTimeout = null;

function setVisualState(state, description) {
  button.className = `microphone-button ${state}`;
  button.setAttribute("aria-label", description);
  liveStatus.textContent = description;
}

function sendEvent(payload) {
  if (events?.readyState !== "open") return false;
  events.send(JSON.stringify(payload));
  return true;
}

function describeError(error) {
  if (error?.name === "NotAllowedError") {
    return "Разрешите доступ к микрофону в браузере";
  }
  if (error?.name === "NotFoundError") {
    return "Микрофон не найден. Подключите петличку и попробуйте снова";
  }
  if (error?.name === "NotReadableError") {
    return "Микрофон занят другой программой";
  }
  return error?.message || "Не удалось начать разговор";
}

function handleServerEvent(event) {
  if (event.type === "session.started") {
    ready = true;
    button.disabled = false;
    setVisualState(
      "listening",
      "Разговор начался. Говорите в любой момент. Нажмите кнопку, чтобы завершить.",
    );

    sendEvent({
      type: "session.commentary.append",
      event_id: crypto.randomUUID(),
      delegation_id: null,
      content: "Привет, меня зовут Стадимейт, что обсудим?",
    });

    maxSessionTimeout = window.setTimeout(() => endConversation(), 3 * 60 * 1000);
    return;
  }

  if (event.type === "session.input_transcript.delta") {
    setVisualState(
      "listening",
      "Стадимейт слушает. Нажмите кнопку, чтобы завершить разговор.",
    );
    return;
  }

  if (event.type === "session.output_transcript.delta") {
    setVisualState(
      "speaking",
      "Стадимейт отвечает. Говорите, чтобы перебить, или нажмите кнопку для завершения.",
    );
    return;
  }

  if (event.type === "session.closed") {
    finalized = true;
    console.info("Сессия завершена", event.usage ?? "");
    cleanup("idle", "Начать новый разговор со Стадимейтом");
    return;
  }

  if (event.type === "error") {
    const message = event.error?.message || "Не удалось продолжить разговор";
    console.error(message, event);
    cleanup("error", `${message}. Нажмите, чтобы попробовать снова.`);
  }
}

async function waitForIceGathering(connection) {
  if (connection.iceGatheringState === "complete") return;

  await new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 2500);
    const onChange = () => {
      if (connection.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

async function startConversation() {
  if (peer || button.disabled) return;

  finalized = false;
  button.disabled = true;
  setVisualState("connecting", "Подключаю Стадимейта…");

  try {
    const healthResponse = await fetch("/api/health");
    const health = await healthResponse.json();
    if (!healthResponse.ok || !health.apiKeyConfigured) {
      throw new Error(health.error || "На сервере не настроен ключ OpenAI");
    }

    peer = new RTCPeerConnection();
    peer.addEventListener("track", (event) => {
      remoteAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
      remoteAudio.play().catch(() => {});
    });
    peer.addEventListener("connectionstatechange", () => {
      if (["failed", "disconnected"].includes(peer?.connectionState)) {
        cleanup("error", "Связь прервалась. Нажмите, чтобы попробовать снова.");
      }
    });

    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    microphone.getTracks().forEach((track) => peer.addTrack(track, microphone));

    events = peer.createDataChannel("oai-events");
    events.addEventListener("message", ({ data }) => {
      try {
        handleServerEvent(JSON.parse(data));
      } catch (error) {
        console.error("Не удалось прочитать событие", error);
      }
    });
    events.addEventListener("close", ({ target }) => {
      if (target !== events || finalized || !peer) return;
      cleanup("error", "Связь прервалась. Нажмите, чтобы попробовать снова.");
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);

    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: peer.localDescription.sdp }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "OpenAI не создал голосовую сессию");

    if (!result.transport?.sdp) throw new Error("OpenAI не вернул SDP-ответ");
    await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
  } catch (error) {
    console.error(error);
    cleanup("error", `${describeError(error)}. Нажмите, чтобы попробовать снова.`);
  }
}

function endConversation() {
  if (!peer) return;

  ready = false;
  button.disabled = true;
  setVisualState("closing", "Завершаю разговор…");
  sendEvent({ type: "session.close" });

  closeTimeout = window.setTimeout(() => {
    if (!finalized) cleanup("idle", "Начать новый разговор со Стадимейтом");
  }, 15000);
}

function cleanup(state, description) {
  window.clearTimeout(closeTimeout);
  window.clearTimeout(maxSessionTimeout);

  const currentEvents = events;
  const currentPeer = peer;
  const currentMicrophone = microphone;
  events = null;
  peer = null;
  microphone = null;
  ready = false;

  currentMicrophone?.getTracks().forEach((track) => track.stop());
  if (currentEvents?.readyState === "open") currentEvents.close();
  currentPeer?.close();
  remoteAudio.srcObject = null;

  button.disabled = false;
  setVisualState(state, description);
}

button.addEventListener("click", () => {
  if (!ready) {
    startConversation();
    return;
  }
  endConversation();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") endConversation();
});

window.addEventListener("beforeunload", () => {
  sendEvent({ type: "session.close" });
  microphone?.getTracks().forEach((track) => track.stop());
});
