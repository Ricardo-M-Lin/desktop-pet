const videos = [
  document.querySelector("#character-a"),
  document.querySelector("#character-b"),
];

const sources = {
  idle: "../assets/idle.webm",
  "walk-left": "../assets/walk-left.webm",
  "walk-right": "../assets/walk-right.webm",
  "turn-right-left": "../assets/turn-right-left.webm",
  "turn-left-right": "../assets/turn-left-right.webm",
};

let currentState = "idle";
let switchToken = 0;
let activeIndex = 0;

function setState(state) {
  if (!sources[state] || state === currentState) return;
  currentState = state;
  const token = ++switchToken;
  const current = videos[activeIndex];
  const nextIndex = 1 - activeIndex;
  const next = videos[nextIndex];

  // Prepare the next clip while the current one remains visible. Swapping a
  // single video element can expose one transparent/black frame during load.
  next.pause();
  next.classList.remove("is-active");
  next.loop = !state.startsWith("turn-");
  next.src = sources[state];
  next.load();

  const activate = () => {
    if (token !== switchToken) return;
    next.currentTime = 0;
    next.play().catch(() => {});
    next.classList.add("is-active");
    current.classList.remove("is-active");
    activeIndex = nextIndex;
    window.setTimeout(() => {
      if (token !== switchToken) return;
      current.pause();
      current.removeAttribute("src");
      current.load();
    }, 80);
  };

  if (next.readyState >= HTMLMediaElement.HAVE_METADATA) {
    window.requestAnimationFrame(activate);
  } else {
    next.addEventListener("loadeddata", activate, { once: true });
  }
}

window.desktopPet?.onStateChange(setState);
