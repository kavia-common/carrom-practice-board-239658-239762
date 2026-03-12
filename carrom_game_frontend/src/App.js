import React, { useRef, useState, useEffect } from "react";
import "./App.css";

/**
 * Color constants for the Monochrome minimal theme.
 */
const COLORS = {
  board: "#ffffff", // surface
  boardBorder: "#111827", // primary
  background: "#f9fafb",
  border: "#111827",
  striker: "#16A34A", // accent/success
  coinWhite: "#ededed",
  coinBlack: "#222",
  coinRed: "#EF4444",
  pocket: "#111827",
  score: "#16A34A",
  text: "#111827",
  button: "#16A34A",
};

/**
 * Carrom configuration
 */
const BOARD_SIZE = 480; // px (square)
const BOARD_MARGIN = 24; // px
const POCKET_RADIUS = 24; // px
const BOARD_BORDER = 6; // px
const COIN_RADIUS = 14; // px
const COIN_TYPES = [
  { color: "black", count: 9 },
  { color: "white", count: 9 },
  { color: "red", count: 1 },
];
const STRIKER_RADIUS = 17; // px
const MAX_STRIKER_DRAG = BOARD_SIZE / 2 - BOARD_BORDER - STRIKER_RADIUS - 4;
const STRIKER_START_Y =
  BOARD_SIZE -
  BOARD_BORDER -
  STRIKER_RADIUS -
  20; /* 20 px from bottom by default */
const STRIKER_SPEED_SCALE = 0.025; // controls how fast release is

/**
 * Util: distance between points
 */
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Util: clamp
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}

/**
 * Arrange coins in the center
 */
function getInitialCoins() {
  // Central red, surrounded by white and black in hexagonal concentric rings, as in real Carrom.
  const center = { x: BOARD_SIZE / 2, y: BOARD_SIZE / 2 };
  const coins = [];
  // Helper for placement
  const ringCoords = (radius, count) => {
    let coords = [];
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count;
      coords.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    }
    return coords;
  };
  // Place red at center
  coins.push({
    x: center.x,
    y: center.y,
    vx: 0,
    vy: 0,
    inPocket: false,
    type: "red",
  });
  // First ring (black-white-black-white-black-white)
  let t = 0;
  const ring1 = ringCoords(COIN_RADIUS * 2, 6);
  for (let i = 0; i < 6; i++) {
    coins.push({
      x: ring1[i].x,
      y: ring1[i].y,
      vx: 0,
      vy: 0,
      inPocket: false,
      type: i % 2 === 0 ? "black" : "white",
    });
  }
  // Second ring (12 coins: alternating B/W, as close as possible)
  t += 6;
  const ring2 = ringCoords(COIN_RADIUS * 4, 12);
  let colorSeq = [
    "black", "white", "white", "black", "black", "white",
    "white", "black", "black", "white", "white", "black",
  ];
  for (let i = 0; i < 12 && t < 19; i++, t++) {
    let type = colorSeq[i];
    if (coins.filter((c) => c.type === type).length < (type === "black" ? 9 : 9)) {
      coins.push({
        x: ring2[i].x,
        y: ring2[i].y,
        vx: 0,
        vy: 0,
        inPocket: false,
        type,
      });
    }
  }
  // Shuffle to ensure an exact count if over/under
  let onBoard = { black: 0, white: 0 };
  return coins.slice(0, 19).map((c) => {
    if (c.type === "black" && onBoard.black >= 9) c.type = "white";
    if (c.type === "white" && onBoard.white >= 9) c.type = "black";
    if (c.type === "black") onBoard.black += 1;
    if (c.type === "white") onBoard.white += 1;
    return { ...c };
  });
}

/** Get color for coin type */
function getCoinColor(type) {
  if (type === "red") return COLORS.coinRed;
  if (type === "black") return COLORS.coinBlack;
  if (type === "white") return COLORS.coinWhite;
}

/**
 * CarromGame component - contains all game state and rendering/handlers
 */
// PUBLIC_INTERFACE
function CarromGame() {
  // Game state
  const [coins, setCoins] = useState(getInitialCoins);
  // Striker state
  const [striker, setStriker] = useState({
    x: BOARD_SIZE / 2,
    y: STRIKER_START_Y,
    vx: 0,
    vy: 0,
    moving: false,
  });
  // Aiming state
  const [aiming, setAiming] = useState(false);
  const [aimStart, setAimStart] = useState(null);
  const [aimVector, setAimVector] = useState(null);
  // Disabling input while things are moving
  const [moving, setMoving] = useState(false);
  // Score state
  const [score, setScore] = useState({ black: 0, white: 0, red: 0 });
  // Coins pocketed (not on board)
  const [pocketed, setPocketed] = useState({ black: 0, white: 0, red: 0 });
  // For triggering re-render during animation
  const rafRef = useRef();
  // Canvas ref
  const canvasRef = useRef();

  // Calculate pockets
  const pockets = [
    { x: BOARD_BORDER + POCKET_RADIUS, y: BOARD_BORDER + POCKET_RADIUS },
    { x: BOARD_SIZE - BOARD_BORDER - POCKET_RADIUS, y: BOARD_BORDER + POCKET_RADIUS },
    { x: BOARD_BORDER + POCKET_RADIUS, y: BOARD_SIZE - BOARD_BORDER - POCKET_RADIUS },
    { x: BOARD_SIZE - BOARD_BORDER - POCKET_RADIUS, y: BOARD_SIZE - BOARD_BORDER - POCKET_RADIUS },
  ];

  // Start aim drag
  const startAim = (e) => {
    if (moving) return;
    let rect = e.target.getBoundingClientRect();
    // Adjust for scroll
    let mx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    let my = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    const d = dist({ x: mx, y: my }, striker);
    if (d <= STRIKER_RADIUS + 8) {
      setAiming(true);
      setAimStart({ x: mx, y: my });
      setAimVector(null);
    }
  };
  // Update aim drag
  const onAimMove = (e) => {
    if (!aiming || moving) return;
    let rect = canvasRef.current.getBoundingClientRect();
    let mx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    let my = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    let dx = striker.x - mx;
    let dy = striker.y - my;
    // Don't allow drag too far
    let mag = Math.min(Math.hypot(dx, dy), 110);
    if (mag < 10) mag = 10;
    let angle = Math.atan2(dy, dx);
    setAimVector({
      dx: mag * Math.cos(angle),
      dy: mag * Math.sin(angle),
      power: clamp(mag, 10, 110),
    });
  };
  // Release aim
  const endAim = () => {
    if (!aiming || moving || !aimVector) {
      setAiming(false);
      setAimVector(null);
      return;
    }
    // Launch striker
    let scale = STRIKER_SPEED_SCALE * aimVector.power;
    setStriker((s) => ({
      ...s,
      vx: (aimVector.dx / aimVector.power) * scale,
      vy: (aimVector.dy / aimVector.power) * scale,
      moving: true,
    }));
    setAiming(false);
    setAimVector(null);
    setMoving(true);
    // Start physics loop
    rafRef.current = requestAnimationFrame(tick);
  };

  // Return striker to start when not moving
  const resetStriker = () => {
    setStriker({
      x: BOARD_SIZE / 2,
      y: STRIKER_START_Y,
      vx: 0,
      vy: 0,
      moving: false,
    });
  };

  // Game physics loop: updates positions, detects collisions, pockets, etc.
  const tick = () => {
    let movingObjects = false;
    let updatedCoins = coins.map((c) => ({ ...c }));
    let strikerCopy = { ...striker };

    // Physics parameters (friction = slow stop)
    const FRICTION = 0.99;
    const STOP_VELOCITY = 0.18;
    // STRIKER MOVEMENT
    if (strikerCopy.moving) {
      strikerCopy.x += strikerCopy.vx * 13;
      strikerCopy.y += strikerCopy.vy * 13;
      strikerCopy.vx *= FRICTION;
      strikerCopy.vy *= FRICTION;
      if (Math.hypot(strikerCopy.vx, strikerCopy.vy) < STOP_VELOCITY) {
        strikerCopy.vx = 0;
        strikerCopy.vy = 0;
        strikerCopy.moving = false;
      } else {
        movingObjects = true;
      }
    }
    // Update coins' positions
    for (let c of updatedCoins) {
      if (c.inPocket) continue;
      c.x += c.vx * 13;
      c.y += c.vy * 13;
      c.vx *= FRICTION;
      c.vy *= FRICTION;
      if (Math.hypot(c.vx, c.vy) >= STOP_VELOCITY) {
        movingObjects = true;
      }
    }
    // COLLISIONS (striker-coin, coin-coin, borders)
    function collide(a, b, radiusA, radiusB) {
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distVal = Math.hypot(dx, dy);
      let minDist = radiusA + radiusB;
      if (distVal <= minDist && distVal > 0) {
        // Move apart
        let nx = dx / distVal,
          ny = dy / distVal;
        let overlap = (minDist - distVal) / 2.0;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        // Compute relative velocity
        let dvx = b.vx - a.vx;
        let dvy = b.vy - a.vy;
        // Along normal
        let dot = dvx * nx + dvy * ny;
        if (dot > 0) return;
        // Assume identical mass, simple elastic collision
        let impulse = dot * 0.9;
        a.vx += nx * impulse;
        a.vy += ny * impulse;
        b.vx -= nx * impulse;
        b.vy -= ny * impulse;
      }
    }
    // Striker-coin collisions
    for (let i = 0; i < updatedCoins.length; i++) {
      let c = updatedCoins[i];
      if (c.inPocket) continue;
      collide(
        strikerCopy,
        c,
        STRIKER_RADIUS,
        COIN_RADIUS
      );
    }
    // Coin-coin collisions
    for (let i = 0; i < updatedCoins.length; i++) {
      for (let j = i + 1; j < updatedCoins.length; j++) {
        if (updatedCoins[i].inPocket || updatedCoins[j].inPocket) continue;
        collide(
          updatedCoins[i],
          updatedCoins[j],
          COIN_RADIUS,
          COIN_RADIUS
        );
      }
    }
    // Borders/reflection
    function handleWall(obj, r) {
      // Left/right
      if (obj.x < BOARD_BORDER + r) {
        obj.x = BOARD_BORDER + r + 1;
        obj.vx *= -0.7;
      }
      if (obj.x > BOARD_SIZE - BOARD_BORDER - r) {
        obj.x = BOARD_SIZE - BOARD_BORDER - r - 1;
        obj.vx *= -0.7;
      }
      // Top/bottom
      if (obj.y < BOARD_BORDER + r) {
        obj.y = BOARD_BORDER + r + 1;
        obj.vy *= -0.7;
      }
      if (obj.y > BOARD_SIZE - BOARD_BORDER - r) {
        obj.y = BOARD_SIZE - BOARD_BORDER - r - 1;
        obj.vy *= -0.7;
      }
    }
    handleWall(strikerCopy, STRIKER_RADIUS);
    for (let c of updatedCoins) {
      if (!c.inPocket) handleWall(c, COIN_RADIUS);
    }
    // Pocket detection
    function checkPocket(obj, r) {
      for (let pocket of pockets) {
        if (dist(obj, pocket) < POCKET_RADIUS - r + 2) {
          return true;
        }
      }
      return false;
    }
    // Pocket coins/striker
    let anyPocketed = false;
    for (let i = 0; i < updatedCoins.length; i++) {
      let c = updatedCoins[i];
      if (!c.inPocket && checkPocket(c, COIN_RADIUS)) {
        // Pocketed!
        c.inPocket = true;
        anyPocketed = true;
        setPocketed((prev) => ({
          ...prev,
          [c.type]: prev[c.type] + 1,
        }));
        setScore((prev) => ({
          ...prev,
          [c.type]: prev[c.type] + (c.type === "red" ? 3 : 1),
        }));
        // Remove coin from movement instantly
        c.vx = 0;
        c.vy = 0;
      }
    }
    // Striker pocketed -> reset with penalty
    if (!strikerCopy.moving && checkPocket(strikerCopy, STRIKER_RADIUS)) {
      setTimeout(() => {
        resetStriker();
      }, 700);
      strikerCopy.x = BOARD_SIZE / 2;
      strikerCopy.y = STRIKER_START_Y;
      strikerCopy.vx = 0;
      strikerCopy.vy = 0;
      strikerCopy.moving = false;
      // Optionally penalty (skipped)
    }

    setStriker(strikerCopy);
    setCoins(updatedCoins);

    if (movingObjects || anyPocketed) {
      rafRef.current = requestAnimationFrame(tick);
      setMoving(true);
    } else {
      setMoving(false);
      rafRef.current = null;
    }
  };

  // Reset game to new session
  const resetGame = () => {
    setCoins(getInitialCoins());
    setStriker({
      x: BOARD_SIZE / 2,
      y: STRIKER_START_Y,
      vx: 0,
      vy: 0,
      moving: false,
    });
    setScore({ black: 0, white: 0, red: 0 });
    setPocketed({ black: 0, white: 0, red: 0 });
    setAiming(false);
    setAimVector(null);
    setMoving(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  // Animate
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Move striker horizontally (by keyboard or click), only when not moving or aiming
  const moveStriker = (delta) => {
    if (moving || aiming) return;
    setStriker((s) => {
      let nextX = clamp(
        s.x + delta,
        BOARD_BORDER + STRIKER_RADIUS + 6,
        BOARD_SIZE - BOARD_BORDER - STRIKER_RADIUS - 6
      );
      return { ...s, x: nextX };
    });
  };

  // Keyboard support for striker left/right
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowLeft") {
        moveStriker(-16);
      } else if (e.key === "ArrowRight") {
        moveStriker(16);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line
  });

  // --- Canvas Drawing ---
  useEffect(() => {
    // Redraw full board/scene
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // Draw background/surface
    ctx.fillStyle = COLORS.board;
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // Draw board boundary
    ctx.lineWidth = BOARD_BORDER * 2;
    ctx.strokeStyle = COLORS.boardBorder;
    ctx.strokeRect(
      BOARD_BORDER,
      BOARD_BORDER,
      BOARD_SIZE - 2 * BOARD_BORDER,
      BOARD_SIZE - 2 * BOARD_BORDER
    );
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#a1a1aa";
    ctx.strokeRect(
      BOARD_BORDER + 12,
      BOARD_BORDER + 12,
      BOARD_SIZE - 2 * (BOARD_BORDER + 12),
      BOARD_SIZE - 2 * (BOARD_BORDER + 12)
    );

    // Draw pockets
    for (let pocket of pockets) {
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, POCKET_RADIUS, 0, 2 * Math.PI, false);
      ctx.fillStyle = COLORS.pocket;
      ctx.globalAlpha = 0.93;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
    // Draw coins
    for (let c of coins) {
      if (c.inPocket) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, COIN_RADIUS, 0, 2 * Math.PI, false);
      ctx.fillStyle = getCoinColor(c.type);
      ctx.shadowColor = "#11182777";
      ctx.shadowBlur = 4;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (c.type === "red") {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#f87171";
        ctx.stroke();
      }
    }
    // Draw striker
    ctx.beginPath();
    ctx.arc(striker.x, striker.y, STRIKER_RADIUS, 0, 2 * Math.PI, false);
    ctx.fillStyle = COLORS.striker;
    ctx.shadowColor = "#16A34A55";
    ctx.shadowBlur = 7;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#003";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw aiming line, if aiming
    if (aiming && aimVector) {
      ctx.beginPath();
      ctx.moveTo(striker.x, striker.y);
      ctx.lineTo(striker.x - aimVector.dx, striker.y - aimVector.dy);
      ctx.strokeStyle = "#16A34A";
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 20]);
      ctx.globalAlpha = 0.28 + (aimVector.power - 10) / 210;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // Draw striker position selector line (not moving & idle)
    if (!moving && !aiming) {
      ctx.beginPath();
      ctx.moveTo(striker.x, striker.y + STRIKER_RADIUS + 3);
      ctx.lineTo(striker.x, striker.y + STRIKER_RADIUS + 16);
      ctx.strokeStyle = "#16A34A";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.375;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Reset shadow
    ctx.shadowColor = "transparent";
  }, [coins, striker, pockets, aiming, aimVector, moving]);

  // --- Main UI Render ----
  return (
    <div
      style={{
        background: COLORS.background,
        minHeight: "100vh",
        padding: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Score/Head UI */}
      <div
        style={{
          minHeight: 48,
          padding: "0.7em 0 0 0",
          width: BOARD_SIZE + BOARD_MARGIN * 2,
          maxWidth: "98vw",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          gap: "1.3em",
          alignItems: "center",
          fontWeight: 600,
          color: COLORS.text,
          fontSize: "1.16rem",
          letterSpacing: 0.3,
        }}
      >
        <span style={{ fontWeight: 900 }}>
          Carrom <span style={{ color: COLORS.score }}>Practice</span>
        </span>
        <span>
          <span style={{ color: "#222" }}>Black:</span>{" "}
          <span style={{ color: COLORS.score }}>{score.black}</span>
        </span>
        <span>
          <span style={{ color: "#eee", background: "#111827", borderRadius: 4, padding: "0 3.5px" }}>
            White:
          </span>{" "}
          <span style={{ color: COLORS.score }}>{score.white}</span>
        </span>
        <span>
          <span style={{ color: COLORS.coinRed, fontWeight: 700 }}>Red:</span>{" "}
          <span style={{ color: COLORS.score }}>{score.red}</span>
        </span>
        <button
          onClick={resetGame}
          aria-label="Reset game"
          style={{
            border: "none",
            padding: "0.45em 1.13em",
            borderRadius: 8,
            minWidth: 44,
            minHeight: 32,
            background: COLORS.button,
            color: "#fff",
            fontWeight: 700,
            letterSpacing: 0.2,
            fontSize: 17,
            boxShadow: "0 2px 7px #11182713",
            cursor: "pointer",
            opacity: moving ? 0.5 : 1,
          }}
          disabled={moving}
        >
          ↻ Reset
        </button>
      </div>
      {/* Board */}
      <div
        style={{
          width: BOARD_SIZE + BOARD_MARGIN * 2,
          height: BOARD_SIZE + BOARD_MARGIN * 2,
          maxWidth: "99vw",
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.background,
        }}
      >
        <canvas
          ref={canvasRef}
          width={BOARD_SIZE}
          height={BOARD_SIZE}
          tabIndex={0}
          aria-label="Carrom Board"
          style={{
            margin: BOARD_MARGIN,
            borderRadius: 16,
            background: COLORS.surface,
            boxShadow: "0 4px 64px #11182713, 0 2px 28px #11182707",
            outline: "none",
            minWidth: BOARD_SIZE,
            minHeight: BOARD_SIZE,
            touchAction: "none",
          }}
          onMouseDown={startAim}
          onTouchStart={startAim}
          onMouseMove={onAimMove}
          onTouchMove={onAimMove}
          onMouseUp={endAim}
          onTouchEnd={endAim}
        />
      </div>
      {/* Info/Instructions (minimalist) */}
      <div
        style={{
          padding: "11px 0 30px 0",
          color: "#666",
          fontSize: 15,
          opacity: 0.78,
          textAlign: "center",
          maxWidth: "93vw",
        }}
      >
        <div>
          <span style={{ color: "#111827", fontWeight: 500 }}>Drag the striker (green circle) to aim and shoot.</span>
        </div>
        <div>
          Use <span style={{ color: "#16A34A", fontWeight: 600 }}>left/right arrow keys</span> to nudge striker; pocket coins for points.
        </div>
      </div>
    </div>
  );
}

/**
 * App wrapper including theme toggle and game.
 */
// PUBLIC_INTERFACE
function App() {
  const [theme, setTheme] = useState("light");

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // PUBLIC_INTERFACE
  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
  };

  // Background color for active theme
  const themeBg =
    theme === "light" ? COLORS.background : "#111827";

  return (
    <div
      className="App"
      style={{
        background: themeBg,
        minHeight: "100vh",
        color: COLORS.text,
        transition: "background 0.3s,color 0.3s",
      }}
    >
      <header
        className="App-header"
        style={{
          background: "none",
          minHeight: "unset",
          alignItems: "stretch",
          padding: 0,
        }}
      >
        <button
          className="theme-toggle"
          style={{
            background: COLORS.button,
            color: "#fff",
            border: "none",
            position: "absolute",
            top: 28,
            right: 28,
            borderRadius: 8,
            padding: "10px 20px",
            fontWeight: 600,
            fontSize: 15,
            transition: "all 0.3s",
            zIndex: 2,
          }}
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? "🌙 Dark" : "☀️ Light"}
        </button>
        <CarromGame />
      </header>
    </div>
  );
}

export default App;

