import { NextResponse } from "next/server";

const SHEET_ID = "1Q6c2CvmnC-kITm30LBPYlcphF2tn3qMkHPPoTN-YAYQ";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

interface ScoreRecord {
  name: string;
  timeFormatted: string;
  timeSeconds: number;
  date?: string;
}

// "00:28" 또는 "0:06" 형태의 분:초 문자열을 초(seconds)로 변환
function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 999999;
  const parts = timeStr.trim().split(":");
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseInt(parts[1], 10) || 0;
    return mins * 60 + secs;
  }
  const single = parseInt(timeStr, 10);
  return isNaN(single) ? 999999 : single;
}

// 분:초 포맷 정규화 ("0:06" -> "00:06")
function normalizeTime(timeStr: string): string {
  const totalSecs = parseTimeToSeconds(timeStr);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// 구글 시트 CSV 파싱 및 Top 3 추출
async function fetchTop3FromGoogleSheet(): Promise<ScoreRecord[]> {
  try {
    const response = await fetch(CSV_URL, {
      cache: "no-store", // 실시간 최신 데이터 조회
    });

    if (!response.ok) {
      throw new Error(`CSV fetch failed: ${response.status}`);
    }

    const csvText = await response.text();
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length <= 1) {
      return [];
    }

    // 첫 행은 헤더 (timestamp, name, finishtime)
    const records: ScoreRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",");
      if (row.length >= 3) {
        const timestamp = row[0]?.trim();
        const name = row[1]?.trim() || "익명";
        const finishtime = row[2]?.trim() || "";

        if (finishtime) {
          const seconds = parseTimeToSeconds(finishtime);
          records.push({
            name,
            timeFormatted: normalizeTime(finishtime),
            timeSeconds: seconds,
            date: timestamp,
          });
        }
      }
    }

    // 완료시간(timeSeconds)이 빠른 순서(오름차순)로 정렬 후 상위 3개 반환
    records.sort((a, b) => a.timeSeconds - b.timeSeconds);
    return records.slice(0, 3);
  } catch (error) {
    console.error("구글 시트 Top 3 조회 에러:", error);
    return [];
  }
}

export async function GET() {
  const top3 = await fetchTop3FromGoogleSheet();
  return NextResponse.json({ success: true, top3 });
}

export async function POST(request: Request) {
  // 클라이언트에서 갱신 요청 시 최신 구글 시트 데이터를 조회하여 반환
  try {
    // 구글 시트 반영 지연(1~2초)을 고려해 잠시 대기 후 조회하거나 바로 조회
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const top3 = await fetchTop3FromGoogleSheet();
    return NextResponse.json({ success: true, top3 });
  } catch {
    return NextResponse.json({ success: false, top3: [] }, { status: 500 });
  }
}
