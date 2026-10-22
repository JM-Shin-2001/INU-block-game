"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import {
  Trophy,
  Play,
  RotateCcw,
  Pause,
  Volume2,
  VolumeX,
  Heart,
  Gamepad2,
  Sparkles,
  Award,
  Clock,
  Target,
  LogOut,
  Settings,
} from "lucide-react";

// 블록 색상 정의 (6가지)
const BRICK_COLORS = [
  { name: "연한 빨강", hex: "#fca5a5", border: "#f87171", isTarget: true },
  { name: "연한 주황", hex: "#fdba74", border: "#fb923c", isTarget: false },
  { name: "연한 노랑", hex: "#fde047", border: "#facc15", isTarget: false },
  { name: "연한 파랑", hex: "#93c5fd", border: "#60a5fa", isTarget: false },
  { name: "연한 녹색", hex: "#86efac", border: "#4ade80", isTarget: false },
  { name: "연한 보라", hex: "#d8b4fe", border: "#c084fc", isTarget: false },
];

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  borderColor: string;
  isTarget: boolean;
  intact: boolean;
}

interface ScoreRecord {
  name: string;
  timeFormatted: string;
  timeSeconds: number;
  date?: string;
}

export default function InuBrickGame() {
  // 화면 상태: 'intro' | 'countdown' | 'playing' | 'paused' | 'success' | 'gameover'
  const [gameState, setGameState] = useState<string>("intro");
  const [userName, setUserName] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(3);
  const [lives, setLives] = useState<number>(3);
  const [redRemoved, setRedRemoved] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [finalTimeStr, setFinalTimeStr] = useState<string>("00:00");
  const [top3, setTop3] = useState<ScoreRecord[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [googleSheetUrl, setGoogleSheetUrl] = useState<string>("");
  const [showConfig, setShowConfig] = useState<boolean>(false);

  // 캔버스 및 게임 루프 레퍼런스
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 게임 물리 상태 (캔버스 내부 크기 800 x 560 기준)
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 560;

  const paddleRef = useRef({
    width: 120,
    height: 16,
    x: 340,
    y: 520,
    speed: 8,
    isLeftPressed: false,
    isRightPressed: false,
  });

  const ballRef = useRef({
    x: 400,
    y: 490,
    radius: 9,
    dx: 3.5,
    dy: -3.5,
    speed: 4.8,
  });

  const bricksRef = useRef<Brick[]>([]);
  const livesRef = useRef<number>(3);
  const redCountRef = useRef<number>(0);
  const gameStateRef = useRef<string>("intro");

  // Keep gameStateRef in sync
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Top 3 불러오기
  const fetchTop3 = useCallback(async () => {
    try {
      const res = await fetch("/api/scores");
      const data = await res.json();
      if (data.success && data.top3) {
        setTop3(data.top3);
      }
    } catch (e) {
      console.error("Top 3 로드 실패:", e);
    }
  }, []);

  useEffect(() => {
    fetchTop3();
    const savedUrl = localStorage.getItem("inu_google_sheet_url");
    if (savedUrl) setGoogleSheetUrl(savedUrl);
  }, [fetchTop3]);

  // Audio Context 초기화 및 블록 충돌 효과음 (Web Audio API)
  const playHitSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      // 귀엽고 청량한 퐁 소리
      osc.frequency.setValueAtTime(620, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {
      console.warn("효과음 재생 실패:", e);
    }
  }, [soundEnabled]);

  // 게임 실패/감소 효과음
  const playMissSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // ignore
    }
  }, [soundEnabled]);

  // 배경 음악 제어 (볼륨 0.25로 적절하게 설정)
  useEffect(() => {
    if (!bgAudioRef.current) {
      const audio = new Audio("/Hyper_Speed_Run.mp3");
      audio.loop = true;
      audio.volume = 0.25;
      bgAudioRef.current = audio;
    }

    const audio = bgAudioRef.current;
    if (gameState === "playing" || gameState === "countdown") {
      if (soundEnabled) {
        audio.play().catch(() => {
          // 브라우저 자동 재생 정책 예외 처리
        });
      } else {
        audio.pause();
      }
    } else {
      audio.pause();
    }

    return () => {
      audio.pause();
    };
  }, [gameState, soundEnabled]);

  // 분:초 포맷터 (예: "01:23")
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // 블록 초기화 (5행 x 8열 = 40개, 연한 빨강 30% 즉 12개 보장)
  const initBricks = () => {
    const rows = 5;
    const cols = 8;
    const total = rows * cols; // 40
    const redTargetCount = 12; // 40의 30% = 12개

    // 12개는 연한 빨강(index 0), 나머지 28개는 1~5번 색상 무작위 배분
    const colorIndices: number[] = [];
    for (let i = 0; i < redTargetCount; i++) {
      colorIndices.push(0);
    }
    for (let i = redTargetCount; i < total; i++) {
      // 1 ~ 5 중 랜덤
      colorIndices.push(Math.floor(Math.random() * 5) + 1);
    }
    // 셔플
    for (let i = colorIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colorIndices[i], colorIndices[j]] = [colorIndices[j], colorIndices[i]];
    }

    const paddingX = 40;
    const paddingTop = 50;
    const brickSpacing = 8;
    const brickW = (CANVAS_WIDTH - paddingX * 2 - brickSpacing * (cols - 1)) / cols;
    const brickH = 24;

    const bricks: Brick[] = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const colorInfo = BRICK_COLORS[colorIndices[idx]];
        bricks.push({
          x: paddingX + c * (brickW + brickSpacing),
          y: paddingTop + r * (brickH + brickSpacing),
          w: brickW,
          h: brickH,
          color: colorInfo.hex,
          borderColor: colorInfo.border,
          isTarget: colorInfo.isTarget,
          intact: true,
        });
        idx++;
      }
    }
    bricksRef.current = bricks;
  };

  // 공 & 패들 위치 초기화
  const resetBallAndPaddle = () => {
    paddleRef.current.x = (CANVAS_WIDTH - paddleRef.current.width) / 2;
    paddleRef.current.isLeftPressed = false;
    paddleRef.current.isRightPressed = false;

    ballRef.current.x = CANVAS_WIDTH / 2;
    ballRef.current.y = paddleRef.current.y - 15;

    // 공 발사 각도 (위쪽을 향하도록)
    const angle = (Math.PI / 4) + Math.random() * (Math.PI / 2);
    const speed = ballRef.current.speed;
    ballRef.current.dx = (Math.random() > 0.5 ? 1 : -1) * speed * Math.cos(angle);
    ballRef.current.dy = -Math.abs(speed * Math.sin(angle));
  };

  // 게임 시작 버튼 클릭
  const handleStartGame = () => {
    if (!userName.trim()) {
      alert("사용자 이름을 입력해주세요!");
      return;
    }
    setLives(3);
    livesRef.current = 3;
    setRedRemoved(0);
    redCountRef.current = 0;
    setElapsedSeconds(0);
    initBricks();
    resetBallAndPaddle();

    // 3, 2, 1 카운트다운 시작
    setGameState("countdown");
    setCountdown(3);
  };

  // 카운트다운 타이머
  useEffect(() => {
    if (gameState !== "countdown") return;

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      // 카운트다운 완료 후 실제 플레이 시작
      setGameState("playing");
    }
  }, [gameState, countdown]);

  // 플레이 중 경과 시간 타이머
  useEffect(() => {
    if (gameState === "playing") {
      timerIntervalRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [gameState]);

  // 미션 성공 처리 (폭죽 + 기록 저장)
  const triggerSuccess = useCallback(async () => {
    setGameState("success");
    const finalFormatted = formatTime(elapsedSeconds);
    setFinalTimeStr(finalFormatted);

    // 축하 폭죽 효과 (canvas-confetti)
    const duration = 3.5 * 1000;
    const animationEnd = Date.now() + duration;
    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"],
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"],
      });

      if (Date.now() < animationEnd) {
        requestAnimationFrame(frame);
      }
    };
    frame();

    // 서버 및 구글시트에 기록 전송
    const scriptUrl =
      googleSheetUrl ||
      process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL ||
      "";

    // 1. 브라우저에서 직접 Google Apps Script 실행 (클라이언트 사이드 연동)
    if (scriptUrl) {
      try {
        const payload = {
          timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
          name: userName,
          finishtime: finalFormatted,
          timeSeconds: elapsedSeconds,
        };

        // Google Apps Script 웹 앱은 CORS 리다이렉션을 사용하므로 no-cors 모드로 안전하게 전송
        await fetch(scriptUrl, {
          method: "POST",
          mode: "no-cors",
          headers: {
            "Content-Type": "text/plain",
          },
          body: JSON.stringify(payload),
        });
        console.log("구글 앱스 스크립트 실행 요청 완료:", scriptUrl);
      } catch (err) {
        console.warn("구글 앱스 스크립트 직접 호출 실패 (서버 프록시로 폴백 시도):", err);
      }
    }

    // 2. 내부 Next.js API 호출 (서버 DB 로컬 저장 및 Top 3 갱신)
    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: userName,
          timeFormatted: finalFormatted,
          timeSeconds: elapsedSeconds,
        }),
      });
      const data = await res.json();
      if (data.success && data.top3) {
        setTop3(data.top3);
      }
    } catch (e) {
      console.error("점수 저장 실패:", e);
    }
  }, [elapsedSeconds, userName, googleSheetUrl]);

  // 게임 루프 (Canvas Rendering & Physics)
  useEffect(() => {
    if (gameState !== "playing" && gameState !== "countdown") {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    const gameLoop = () => {
      if (!isRunning) return;

      const paddle = paddleRef.current;
      const ball = ballRef.current;
      const bricks = bricksRef.current;

      // 1. 상태 업데이트 (playing 상태에서만 물리 이동)
      if (gameStateRef.current === "playing") {
        // 패들 이동 (PC 좌우 방향키)
        if (paddle.isLeftPressed) {
          paddle.x = Math.max(10, paddle.x - paddle.speed);
        }
        if (paddle.isRightPressed) {
          paddle.x = Math.min(CANVAS_WIDTH - paddle.width - 10, paddle.x + paddle.speed);
        }

        // 공 이동
        ball.x += ball.dx;
        ball.y += ball.dy;

        // 벽 충돌 (좌/우)
        if (ball.x - ball.radius <= 0) {
          ball.x = ball.radius;
          ball.dx = -ball.dx;
          playHitSound();
        } else if (ball.x + ball.radius >= CANVAS_WIDTH) {
          ball.x = CANVAS_WIDTH - ball.radius;
          ball.dx = -ball.dx;
          playHitSound();
        }

        // 상단 벽 충돌
        if (ball.y - ball.radius <= 0) {
          ball.y = ball.radius;
          ball.dy = -ball.dy;
          playHitSound();
        }

        // 패들 충돌
        if (
          ball.y + ball.radius >= paddle.y &&
          ball.y - ball.radius <= paddle.y + paddle.height &&
          ball.x >= paddle.x &&
          ball.x <= paddle.x + paddle.width &&
          ball.dy > 0
        ) {
          // 패들의 맞은 위치에 따라 반사 각도 조절
          const hitPoint = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
          const maxAngle = (75 * Math.PI) / 180; // 최대 75도
          const bounceAngle = hitPoint * maxAngle;
          const currentSpeed = ball.speed;

          ball.dx = currentSpeed * Math.sin(bounceAngle);
          ball.dy = -Math.abs(currentSpeed * Math.cos(bounceAngle));
          playHitSound();
        }

        // 블록 충돌 감지
        for (let i = 0; i < bricks.length; i++) {
          const b = bricks[i];
          if (!b.intact) continue;

          // AABB + 원 충돌 검사
          const closestX = Math.max(b.x, Math.min(ball.x, b.x + b.w));
          const closestY = Math.max(b.y, Math.min(ball.y, b.y + b.h));
          const distX = ball.x - closestX;
          const distY = ball.y - closestY;

          if (distX * distX + distY * distY < ball.radius * ball.radius) {
            b.intact = false;
            playHitSound();

            // 충돌 면 계산 및 튕김
            const prevX = ball.x - ball.dx;
            const prevY = ball.y - ball.dy;
            if (prevX <= b.x || prevX >= b.x + b.w) {
              ball.dx = -ball.dx;
            } else {
              ball.dy = -ball.dy;
            }

            // 연한 빨강색 블록 체크
            if (b.isTarget) {
              redCountRef.current += 1;
              const newCount = redCountRef.current;
              setRedRemoved(newCount);

              // 3개 제거 시 미션 성공!
              if (newCount >= 3) {
                triggerSuccess();
                return;
              }
            }
            break;
          }
        }

        // 바닥 추락 (놓침)
        if (ball.y - ball.radius > CANVAS_HEIGHT) {
          playMissSound();
          livesRef.current -= 1;
          const currentLives = livesRef.current;
          setLives(currentLives);

          if (currentLives <= 0) {
            // 미션 실패: 시간 측정 중단, 실패 메시지
            setGameState("gameover");
            return;
          } else {
            // 목숨이 남아있으면 공과 패들 재배치 후 계속 진행
            resetBallAndPaddle();
          }
        }
      }

      // 2. 화면 렌더링
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // 배경
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // 은은한 그리드 라인
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < CANVAS_WIDTH; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < CANVAS_HEIGHT; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      // 블록 그리기
      bricks.forEach((b) => {
        if (!b.intact) return;

        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, 4);
        ctx.fill();

        ctx.strokeStyle = b.borderColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 연한 빨강(타깃) 블록은 반짝이는 별 표식 표시
        if (b.isTarget) {
          ctx.fillStyle = "#b91c1c";
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("★", b.x + b.w / 2, b.y + b.h / 2);
        }
      });

      // 패들 그리기
      const paddleGrad = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.height);
      paddleGrad.addColorStop(0, "#38bdf8");
      paddleGrad.addColorStop(1, "#0284c7");
      ctx.fillStyle = paddleGrad;
      ctx.beginPath();
      ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, 8);
      ctx.fill();

      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 공 그리기
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      const ballGrad = ctx.createRadialGradient(
        ball.x - 3,
        ball.y - 3,
        2,
        ball.x,
        ball.y,
        ball.radius
      );
      ballGrad.addColorStop(0, "#ffffff");
      ballGrad.addColorStop(0.4, "#fbbf24");
      ballGrad.addColorStop(1, "#f59e0b");
      ctx.fillStyle = ballGrad;
      ctx.fill();

      ctx.strokeStyle = "#fef3c7";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 카운트다운 오버레이 렌더링
      if (gameStateRef.current === "countdown") {
        ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        ctx.font = "bold 72px sans-serif";
        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(countdown.toString(), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

        ctx.font = "20px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("준비하세요! 빨간색 블록 3개를 격파하면 미션 성공!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 65);
      }

      animFrameIdRef.current = requestAnimationFrame(gameLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(gameLoop);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [gameState, countdown, playHitSound, playMissSound, triggerSuccess]);

  // 키보드 이벤트 (좌우 방향키로만 패들 이동)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        paddleRef.current.isLeftPressed = true;
      } else if (e.key === "ArrowRight") {
        paddleRef.current.isRightPressed = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        paddleRef.current.isLeftPressed = false;
      } else if (e.key === "ArrowRight") {
        paddleRef.current.isRightPressed = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 모바일 터치 및 스와이프 핸들러
  const touchStartXRef = useRef<number | null>(null);
  const touchPaddleStartXRef = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      touchStartXRef.current = e.touches[0].clientX;
      touchPaddleStartXRef.current = paddleRef.current.x;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (touchStartXRef.current === null || e.touches.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchStartXRef.current;

    // 캔버스 실제 렌더링 너비와 내부 좌표계(800) 간 스케일 비율 계산
    const rect = canvas.getBoundingClientRect();
    const scale = CANVAS_WIDTH / rect.width;

    const newX = touchPaddleStartXRef.current + deltaX * scale;
    paddleRef.current.x = Math.max(10, Math.min(CANVAS_WIDTH - paddleRef.current.width - 10, newX));
  };

  const handleTouchEnd = () => {
    touchStartXRef.current = null;
  };

  // 구글 시트 웹앱 URL 저장
  const handleSaveGoogleSheetUrl = () => {
    localStorage.setItem("inu_google_sheet_url", googleSheetUrl);
    setShowConfig(false);
    alert("구글 시트 연동 URL이 저장되었습니다!");
  };

  // 재시작 (이름 작성 화면으로 이동)
  const handleRestartToNameScreen = () => {
    setGameState("intro");
    setLives(3);
    setRedRemoved(0);
    setElapsedSeconds(0);
  };

  // 게임 일시정지 / 계속하기 토글
  const togglePause = () => {
    if (gameState === "playing") {
      setGameState("paused");
    } else if (gameState === "paused") {
      setGameState("playing");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-sky-500 selection:text-white">
      {/* 헤더 바 */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Gamepad2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-sky-400 via-blue-300 to-indigo-400 bg-clip-text text-transparent">
              INU 벽돌깨기
            </h1>
            <p className="text-xs text-slate-400">인천대학교 도시공학과 202102345 신제민</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 구글 시트 설정 버튼 */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            title="구글 시트 연동 설정"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* 소리 토글 */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            title={soundEnabled ? "소리 끄기" : "소리 켜기"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-red-400" />}
          </button>
        </div>
      </header>

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-2 sm:p-4 flex flex-col items-center justify-center">
        {/* 구글 시트 연동 모달/설정 팝업 */}
        {showConfig && (
          <div className="w-full max-w-lg mb-4 p-4 rounded-xl border border-sky-500/30 bg-slate-900/90 shadow-2xl backdrop-blur">
            <h3 className="font-semibold text-sm text-sky-400 mb-2 flex items-center gap-1.5">
              <Settings className="w-4 h-4" /> 구글 스프레드시트 Web App URL 연동 (선택)
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              Google Apps Script 웹 앱 URL을 등록하시면 미션 완료 시 실시간으로 본인 구글 시트에도 기록됩니다. 미등록 시에도 서버 DB 및 아래 Top 3 순위표에는 자동 저장됩니다.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={googleSheetUrl}
                onChange={(e) => setGoogleSheetUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg focus:outline-none focus:border-sky-500 text-slate-200"
              />
              <button
                onClick={handleSaveGoogleSheetUrl}
                className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 rounded-lg text-white font-medium cursor-pointer"
              >
                저장
              </button>
            </div>
          </div>
        )}

        {/* 1. 첫 화면 (사용자 이름란 & 시작 버튼 & Mascot 이미지) */}
        {gameState === "intro" && (
          <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur text-center flex flex-col items-center">
            {/* 마스코트 이미지 */}
            <div className="relative w-44 h-44 mb-4 rounded-2xl overflow-hidden border-2 border-sky-500/40 shadow-lg shadow-sky-500/20 group">
              <Image
                src="/Mascot.jpg"
                alt="인천대학교 마스코트"
                fill
                priority
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>

            {/* 학과 및 학번 정보 명시 */}
            <div className="mb-6">
              <span className="inline-block px-3 py-1 text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full mb-2">
                인천대학교 도시공학과
              </span>
              <h2 className="text-2xl font-bold text-white tracking-tight">도시공학과 202102345 신제민</h2>
              <p className="text-sm text-slate-400 mt-1">INU 블록 격파 미션에 오신 것을 환영합니다!</p>
            </div>

            {/* 사용자 이름 입력란 */}
            <div className="w-full mb-5 text-left">
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                플레이어 이름 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStartGame()}
                placeholder="이름을 입력하세요 (예: 신제민)"
                maxLength={15}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-white placeholder-slate-500 transition"
              />
            </div>

            {/* 게임 규칙 요약 */}
            <div className="w-full bg-slate-950/60 rounded-xl p-3 border border-slate-800 text-left mb-6 text-xs text-slate-400 space-y-1">
              <p className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Target className="w-3.5 h-3.5 text-red-400" />
                <span className="text-red-400 font-semibold">연한 빨강 블록 3개</span>를 격파하면 미션 성공!
              </p>
              <p>• 생명은 총 3개 제공 (공을 놓칠 시 1개씩 감소)</p>
              <p>• PC: 좌/우 방향키 이동 | 모바일: 패들 스와이프 이동</p>
            </div>

            {/* 게임 시작 버튼 */}
            <button
              onClick={handleStartGame}
              className="w-full py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2 transition transform active:scale-98 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" /> 게임 시작
            </button>
          </div>
        )}

        {/* 2. 게임 플레이 화면 (캔버스 & 조작 버튼 & 상단 HUD) */}
        {(gameState === "countdown" ||
          gameState === "playing" ||
          gameState === "paused" ||
          gameState === "success" ||
          gameState === "gameover") && (
          <div className="w-full flex flex-col items-center">
            {/* 상단 게임 정보 패널 (HUD) */}
            <div className="w-full max-w-[800px] bg-slate-900 border border-slate-800 rounded-t-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              {/* 플레이어 이름 */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-xs">플레이어:</span>
                <span className="font-semibold text-sky-400">{userName}</span>
              </div>

              {/* 시간 측정 */}
              <div className="flex items-center gap-1.5 font-mono text-slate-200 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                <Clock className="w-4 h-4 text-sky-400" />
                <span>{gameState === "gameover" ? "--:--" : formatTime(elapsedSeconds)}</span>
              </div>

              {/* 연한 빨강 미션 타깃 카운트 */}
              <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-500/30 px-3 py-1 rounded-lg">
                <Target className="w-4 h-4 text-red-400" />
                <span className="text-xs text-red-300">연한 빨강:</span>
                <span className="font-bold text-red-400">
                  {redRemoved} / 3
                </span>
              </div>

              {/* 생명 표시 (3개) */}
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((heartIndex) => (
                  <Heart
                    key={heartIndex}
                    className={`w-5 h-5 transition ${
                      heartIndex <= lives
                        ? "text-red-500 fill-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.5)]"
                        : "text-slate-700"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* 게임 캔버스 컨테이너 */}
            <div className="relative w-full max-w-[800px] aspect-[800/560] bg-slate-950 border-x border-b border-slate-800 rounded-b-xl overflow-hidden shadow-2xl">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="w-full h-full block cursor-none touch-none"
              />

              {/* 일시정지 오버레이 */}
              {gameState === "paused" && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                  <Pause className="w-12 h-12 text-sky-400 mb-3" />
                  <h3 className="text-2xl font-bold text-white mb-2">게임 일시 정지됨</h3>
                  <p className="text-sm text-slate-400 mb-6">잠시 숨을 고르고 계속 진행하세요.</p>
                  <button
                    onClick={togglePause}
                    className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl transition cursor-pointer"
                  >
                    게임 계속하기
                  </button>
                </div>
              )}

              {/* 미션 성공 팝업 오버레이 */}
              {gameState === "success" && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in-95 duration-300">
                  <div className="w-16 h-16 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-3">
                    <Sparkles className="w-8 h-8 text-amber-400" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-1">
                    🎉 게임 미션 성공! 🎉
                  </h3>
                  <p className="text-slate-300 text-sm mb-4">
                    연한 빨강 블록 3개를 모두 격파하였습니다!
                  </p>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 w-full max-w-xs">
                    <div className="text-xs text-slate-400 mb-1">완료 소요 시간</div>
                    <div className="text-3xl font-mono font-bold text-sky-400 tracking-wider">
                      {finalTimeStr}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">플레이어: {userName}</div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setGameState("intro")}
                      className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-sky-600/30 transition cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" /> 게임 종료
                    </button>
                  </div>
                </div>
              )}

              {/* 미션 실패 팝업 오버레이 */}
              {gameState === "gameover" && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-3">
                    <Heart className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">
                    게임 미션 실패!
                  </h3>
                  <p className="text-slate-400 text-sm max-w-sm mb-6">
                    모든 생명을 잃었습니다. 공을 놓치지 않도록 조심하세요!
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setGameState("intro")}
                      className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-sky-600/30 transition cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" /> 게임 종료
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 하단 제어 버튼 바 (중간 멈춤, 게임 종료) */}
            <div className="w-full max-w-[800px] mt-2 sm:mt-4 flex items-center justify-center gap-2 sm:gap-3">
              {(gameState === "playing" || gameState === "paused") && (
                <button
                  onClick={togglePause}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                >
                  {gameState === "playing" ? (
                    <>
                      <Pause className="w-4 h-4" /> 게임 멈춤
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> 계속하기
                    </>
                  )}
                </button>
              )}

              <button
                onClick={() => setGameState("intro")}
                className="px-4 py-2 bg-red-950/40 hover:bg-red-900/40 text-red-300 text-sm font-medium rounded-xl flex items-center gap-1.5 border border-red-900/50 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" /> 게임 종료
              </button>
            </div>

            {/* 모바일 가이드 */}
            <p className="text-xs text-slate-500 mt-2 sm:hidden text-center">
              💡 모바일: 화면의 게임 판을 좌우로 스와이프하여 패들을 움직이세요!
            </p>
          </div>
        )}

        {/* 3. 명예의 전당 (Top 3 랭킹 보드) - 게임 중이 아닐 때만 모바일에 표시하거나 PC에서만 표시 */}
        <div className={`w-full max-w-[800px] mt-6 sm:mt-8 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur ${
          gameState !== "intro" ? "hidden sm:block" : "block"
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-base flex items-center gap-2 text-white">
              <Trophy className="w-5 h-5 text-amber-400" />
              명예의 전당 (최단 완료 Top 3)
            </h3>
            <span className="text-xs text-slate-500">Google Sheets / Server Sync</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((idx) => {
              const record = top3[idx];
              const rankMedals = ["🥇 1위", "🥈 2위", "🥉 3위"];
              const rankColors = [
                "border-amber-500/40 bg-amber-500/5 text-amber-300",
                "border-slate-400/40 bg-slate-400/5 text-slate-300",
                "border-amber-700/40 bg-amber-700/5 text-amber-600",
              ];

              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-xl border ${rankColors[idx]} flex flex-col justify-between`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{rankMedals[idx]}</span>
                    <Award className="w-4 h-4 opacity-70" />
                  </div>
                  {record ? (
                    <div>
                      <div className="font-semibold text-white truncate">{record.name}</div>
                      <div className="text-xs font-mono font-bold text-sky-400 mt-0.5">
                        기록: {record.timeFormatted}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 py-2">도전자를 기다리는 중...</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* 푸터 */}
      <footer className={`border-t border-slate-900 bg-slate-950 px-4 py-3 text-center text-xs text-slate-500 ${
        gameState !== "intro" ? "hidden sm:block" : "block"
      }`}>
        © 2026 INU 인천대학교 도시공학과 202102345 신제민. All rights reserved.
      </footer>
    </div>
  );
}
