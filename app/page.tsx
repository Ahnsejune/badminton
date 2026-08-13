"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

type Team = { id: number; players: string };
type Game = { id: string; round: number; a: number; b: number };
type Round = { games: Game[] };
type Scores = Record<string, [string, string]>;
type Stat = Team & { played: number; wins: number; losses: number; pf: number; pa: number; h2h: number };

const initialTeams: Team[] = [];

function makeSchedule(teams: Team[], courtCount: number, shuffleSeed: number): Round[] {
  if (teams.length < 2 || courtCount < 1) return [];
  const result: Round[] = [];
  const pending: Game[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i].id, b = teams[j].id;
      pending.push({ id: `t${Math.min(a, b)}-${Math.max(a, b)}`, round: 0, a, b });
    }
  }
  if (shuffleSeed) {
    let seed = shuffleSeed >>> 0;
    const random = () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    for (let i = pending.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pending[i], pending[j]] = [pending[j], pending[i]]; }
  }
  const lastPlayed = new Map<number, number>();
  while (pending.length) {
    const roundIndex = result.length;
    const used = new Set<number>();
    const round: Round = { games: [] };
    while (round.games.length < courtCount) {
      const candidates = pending
        .map((game, index) => ({ game, index }))
        .filter(({ game }) => !used.has(game.a) && !used.has(game.b));
      if (!candidates.length) break;
      candidates.sort((x, y) => {
        const xRepeat = Number(lastPlayed.get(x.game.a) === roundIndex - 1) + Number(lastPlayed.get(x.game.b) === roundIndex - 1);
        const yRepeat = Number(lastPlayed.get(y.game.a) === roundIndex - 1) + Number(lastPlayed.get(y.game.b) === roundIndex - 1);
        const xRest = (roundIndex - (lastPlayed.get(x.game.a) ?? -2)) + (roundIndex - (lastPlayed.get(x.game.b) ?? -2));
        const yRest = (roundIndex - (lastPlayed.get(y.game.a) ?? -2)) + (roundIndex - (lastPlayed.get(y.game.b) ?? -2));
        return xRepeat - yRepeat || yRest - xRest || x.index - y.index;
      });
      const selected = candidates[0];
      round.games.push(selected.game); used.add(selected.game.a); used.add(selected.game.b);
      pending.splice(selected.index, 1);
    }
    round.games.forEach(game => { lastPlayed.set(game.a, roundIndex); lastPlayed.set(game.b, roundIndex); });
    result.push(round);
  }
  return result.map((round, ri) => ({ games: round.games.map(g => ({ ...g, round: ri + 1 })) }));
}

function validScore(score?: [string, string]) {
  if (!score || score[0] === "" || score[1] === "") return false;
  const a = Number(score[0]), b = Number(score[1]);
  return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 && a !== b;
}

export default function Home() {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [courtCount, setCourtCount] = useState(0);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [scores, setScores] = useState<Scores>({});
  const [draftScores, setDraftScores] = useState<Scores>({});
  const [activeRound, setActiveRound] = useState(1);
  const [savingGame, setSavingGame] = useState("");
  const [syncError, setSyncError] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(false);
  const [shuffleAuthOpen, setShuffleAuthOpen] = useState(false);
  const [shufflePassword, setShufflePassword] = useState("");
  const [shuffleAuthError, setShuffleAuthError] = useState(false);
  const [protectedAction, setProtectedAction] = useState<"shuffle" | "reset" | "rebuild">("shuffle");
  const [displayMode, setDisplayMode] = useState(false);
  const [newTeam, setNewTeam] = useState("");

  useEffect(() => {
    const leagueRef = doc(db, "leagues", "main");
    return onSnapshot(leagueRef, snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (Array.isArray(data.teams)) setTeams(data.teams as Team[]);
        if (data.scores && typeof data.scores === "object") { setScores(data.scores as Scores); setDraftScores(data.scores as Scores); }
        if (typeof data.courtCount === "number") setCourtCount(Math.max(0, data.courtCount));
        if (typeof data.shuffleSeed === "number") setShuffleSeed(data.shuffleSeed);
      } else {
        const storedTeams = localStorage.getItem("shuttle-league-teams");
        const storedScores = localStorage.getItem("shuttle-league-scores-v2");
        const storedCourts = localStorage.getItem("shuttle-league-courts");
        const storedSeed = localStorage.getItem("shuttle-league-shuffle-seed");
        if (storedTeams) setTeams(JSON.parse(storedTeams));
        if (storedScores) { const parsed = JSON.parse(storedScores); setScores(parsed); setDraftScores(parsed); }
        if (storedCourts) setCourtCount(Math.max(0, Number(storedCourts) || 0));
        if (storedSeed) setShuffleSeed(Number(storedSeed) || 0);
      }
      setSyncError("");
    }, () => setSyncError("Firebase 연결을 확인해 주세요."));
  }, []);

  const rounds = useMemo(() => makeSchedule(teams, courtCount, shuffleSeed), [teams, courtCount, shuffleSeed]);
  const games = useMemo(() => rounds.flatMap(r => r.games), [rounds]);
  const completed = games.filter(g => validScore(scores[g.id])).length;

  useEffect(() => { if (activeRound > rounds.length) setActiveRound(Math.max(1, rounds.length)); }, [rounds.length, activeRound]);

  const ranking = useMemo(() => {
    const stats = new Map(teams.map(t => [t.id, { ...t, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, h2h: 0 } as Stat]));
    games.forEach(g => {
      const s = scores[g.id]; if (!validScore(s)) return;
      const a = stats.get(g.a)!, b = stats.get(g.b)!, sa = Number(s[0]), sb = Number(s[1]);
      a.played++; b.played++; a.pf += sa; a.pa += sb; b.pf += sb; b.pa += sa;
      if (sa > sb) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
    });
    const groups = new Map<string, Stat[]>();
    stats.forEach(s => { const key = `${s.wins}-${s.losses}`; groups.set(key, [...(groups.get(key) ?? []), s]); });
    groups.forEach(group => {
      if (group.length < 2) return;
      const tied = new Set(group.map(t => t.id));
      games.forEach(g => {
        if (!tied.has(g.a) || !tied.has(g.b) || !validScore(scores[g.id])) return;
        const sc = scores[g.id]; const winner = Number(sc[0]) > Number(sc[1]) ? g.a : g.b;
        stats.get(winner)!.h2h++;
      });
    });
    return [...stats.values()].sort((a, b) =>
      b.wins - a.wins || a.losses - b.losses || b.h2h - a.h2h ||
      (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.id - b.id
    );
  }, [teams, games, scores]);

  const getTeam = (id: number) => teams.find(t => t.id === id)!;
  const current = rounds[activeRound - 1];

  function changeScore(id: string, side: 0 | 1, value: string) {
    if (value !== "" && (!/^\d{1,2}$/.test(value) || Number(value) > 99)) return;
    setDraftScores(prev => ({ ...prev, [id]: side === 0 ? [value, prev[id]?.[1] ?? ""] : [prev[id]?.[0] ?? "", value] }));
  }
  async function saveMatch(id: string) {
    const score = draftScores[id];
    if (!validScore(score)) { alert(score?.[0] === score?.[1] && score?.[0] !== "" ? "동점은 저장할 수 없습니다." : "두 팀의 점수를 모두 입력해 주세요."); return; }
    setSavingGame(id); setSyncError("");
    const nextScores = { ...scores, [id]: score };
    try {
      await setDoc(doc(db, "leagues", "main"), { teams, courtCount, shuffleSeed, scores: nextScores, updatedAt: serverTimestamp() });
      setScores(nextScores); localStorage.setItem("shuttle-league-scores-v2", JSON.stringify(nextScores));
    } catch { setSyncError("경기 결과 저장에 실패했습니다. Firestore 권한을 확인해 주세요."); }
    finally { setSavingGame(""); }
  }
  async function reset() { if (confirm("입력한 모든 경기 점수를 지울까요?")) { setScores({}); setDraftScores({}); localStorage.removeItem("shuttle-league-scores-v2"); try { await setDoc(doc(db,"leagues","main"),{teams,courtCount,shuffleSeed,scores:{},updatedAt:serverTimestamp()}); } catch { setSyncError("초기화 내용을 Firebase에 저장하지 못했습니다."); } } }
  function requestProtectedAction(action: "shuffle" | "reset" | "rebuild") { setProtectedAction(action); setShufflePassword(""); setShuffleAuthError(false); setShuffleAuthOpen(true); }
  async function shuffleSchedule() {
    if (completed > 0 && !confirm("대진 순서가 변경됩니다. 저장된 경기 결과는 유지됩니다. 경기를 섞을까요?")) return;
    const nextSeed = Date.now(); setShuffleSeed(nextSeed); setActiveRound(1); localStorage.setItem("shuttle-league-shuffle-seed", String(nextSeed));
    try { await setDoc(doc(db,"leagues","main"),{teams,courtCount,shuffleSeed:nextSeed,scores,updatedAt:serverTimestamp()}); }
    catch { setSyncError("섞은 대진을 Firebase에 저장하지 못했습니다."); }
  }
  function authorizeShuffle(e: FormEvent) {
    e.preventDefault();
    if (shufflePassword !== "1207") { setShuffleAuthError(true); return; }
    setShufflePassword(""); setShuffleAuthError(false); setShuffleAuthOpen(false);
    if (protectedAction === "shuffle") void shuffleSchedule();
    else if (protectedAction === "reset") void reset();
    else executePersistEdits();
  }
  function login(e: FormEvent) { e.preventDefault(); if (password === "1207") { setAuthenticated(true); setPassword(""); setAuthError(false); } else setAuthError(true); }
  async function commitTeams(next: Team[]) {
    setTeams(next); setScores({}); setDraftScores({}); setActiveRound(1);
    localStorage.setItem("shuttle-league-teams", JSON.stringify(next));
    localStorage.removeItem("shuttle-league-scores-v2");
    try { await setDoc(doc(db,"leagues","main"),{teams:next,courtCount,shuffleSeed,scores:{},updatedAt:serverTimestamp()}); }
    catch { setSyncError("팀 정보를 Firebase에 저장하지 못했습니다."); }
  }
  function addTeam(e: FormEvent) { e.preventDefault(); const name = newTeam.trim(); if (!name) return; commitTeams([...teams, { id: Math.max(0, ...teams.map(t => t.id)) + 1, players: name }]); setNewTeam(""); }
  function editTeam(id: number, players: string) { setTeams(prev => prev.map(t => t.id === id ? { ...t, players } : t)); }
  function persistEdits() { requestProtectedAction("rebuild"); }
  function executePersistEdits() {
    if (teams.length < 2) return alert("리그 진행을 위해 최소 2팀을 추가해 주세요.");
    if (courtCount < 1) return alert("운영 코트 수를 1개 이상 입력해 주세요.");
    if (teams.some(t => !t.players.trim())) return alert("팀 이름을 모두 입력해 주세요.");
    const cleaned = teams.map(t => ({ ...t, players: t.players.trim() }));
    const stored = localStorage.getItem("shuttle-league-teams");
    const teamChanged = stored ? stored !== JSON.stringify(cleaned) : JSON.stringify(cleaned) !== JSON.stringify(initialTeams);
    localStorage.setItem("shuttle-league-courts", String(courtCount));
    if (teamChanged) void commitTeams(cleaned); else { setTeams(cleaned); setActiveRound(1); localStorage.setItem("shuttle-league-teams", JSON.stringify(cleaned)); void setDoc(doc(db,"leagues","main"),{teams:cleaned,courtCount,shuffleSeed,scores,updatedAt:serverTimestamp()}).catch(()=>setSyncError("설정을 Firebase에 저장하지 못했습니다.")); }
    alert(`${courtCount}개 코트 기준으로 대진표가 다시 편성되었습니다.${teamChanged ? " 기존 경기 점수는 초기화되었습니다." : " 기존 점수는 유지됩니다."}`);
  }
  function exportLeagueImage() {
    const width = 1400, rowHeight = 48;
    const height = 250 + ranking.length * rowHeight + 100 + games.length * rowHeight;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#f5f3ea"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#145c3e"; ctx.fillRect(0, 0, width, 150);
    ctx.fillStyle = "#d9ff43"; ctx.font = "bold 46px Arial, sans-serif"; ctx.fillText("SHUTTLE CLUB", 60, 72);
    ctx.fillStyle = "#ffffff"; ctx.font = "24px Arial, sans-serif"; ctx.fillText("배드민턴 리그 경기 기록", 60, 115);
    let y = 205; ctx.fillStyle = "#142019"; ctx.font = "bold 30px Arial, sans-serif"; ctx.fillText("최종 순위", 60, y);
    y += 45; ctx.font = "bold 19px Arial, sans-serif";
    ranking.forEach((t, i) => { ctx.fillStyle = i === 0 ? "#e5f7ad" : i % 2 ? "#ffffff" : "#edf0ec"; ctx.fillRect(50, y - 31, 1300, 42); ctx.fillStyle = "#142019"; ctx.fillText(`${i + 1}위`, 70, y); ctx.fillText(t.players, 170, y); ctx.fillText(`${t.wins}승 ${t.losses}패`, 700, y); ctx.fillText(`득실 ${t.pf - t.pa > 0 ? "+" : ""}${t.pf - t.pa}`, 950, y); y += rowHeight; });
    y += 45; ctx.font = "bold 30px Arial, sans-serif"; ctx.fillText("전체 경기 결과", 60, y); y += 45; ctx.font = "18px Arial, sans-serif";
    games.forEach(g => { const score = scores[g.id]; const resultText = validScore(score) ? `${score[0]} : ${score[1]}` : "미완료"; ctx.fillStyle = y / rowHeight % 2 < 1 ? "#ffffff" : "#edf0ec"; ctx.fillRect(50, y - 30, 1300, 42); ctx.fillStyle = "#142019"; ctx.fillText(`${g.round}R`, 70, y); ctx.fillText(getTeam(g.a).players, 170, y); ctx.fillText(resultText, 650, y); ctx.fillText(getTeam(g.b).players, 820, y); y += rowHeight; });
    const link = document.createElement("a"); link.download = `배드민턴-리그-기록-${new Date().toISOString().slice(0,10)}.png`; link.href = canvas.toDataURL("image/png"); link.click();
  }
  function deleteTeam(id: number) { if (confirm("이 팀을 삭제할까요? 기존 경기 점수는 초기화됩니다.")) void commitTeams(teams.filter(t => t.id !== id)); }

  if (displayMode) return <main className="display-mode">
    <div className="display-top"><div><span>SHUTTLE CLUB</span><h1>리그 전광판</h1></div><button onClick={()=>setDisplayMode(false)}>전광판 종료</button></div>
    <section className="display-ranking"><div className="display-heading"><span>LIVE STANDINGS</span><h2>실시간 순위</h2></div><div className="display-rank-head"><span>순위</span><span>팀</span><span>승</span><span>패</span><span>득실차</span></div><div className="display-rank-list">{ranking.map((t,i)=><article key={t.id}><b>{i+1}</b><strong>{t.players}</strong><span>{t.wins}</span><span>{t.losses}</span><em>{t.pf-t.pa>0?"+":""}{t.pf-t.pa}</em></article>)}</div></section>
  </main>;

  return <main>
    <header><div className="brand"><span className="mark">S</span><div><strong>SHUTTLE CLUB</strong><small>BADMINTON LEAGUE</small></div></div><div className="header-actions"><button className="display-btn" onClick={()=>setDisplayMode(true)}>전광판</button><button className="export-btn" onClick={exportLeagueImage}>기록 이미지</button><button className="admin-btn" onClick={() => setAdminOpen(true)}>팀 관리</button><button className="ghost" onClick={()=>requestProtectedAction("reset")}>초기화</button><button className="shuffle-btn" onClick={()=>requestProtectedAction("shuffle")}>↻ 경기 섞기</button></div></header>
    <section id="schedule" className="section">{syncError&&<p className="sync-error">{syncError}</p>}<div className="section-title"><div><p>LEAGUE SCHEDULE</p><h2>리그 경기 일정</h2></div><div className="progress"><b>{completed}</b><span>/ {games.length}</span><small>경기 완료</small></div></div>
      {rounds.length ? <><div className="round-tabs">{rounds.map((_,i)=><button key={i} className={activeRound===i+1?"active":""} onClick={()=>setActiveRound(i+1)}>{i+1}R</button>)}</div>
      <div className="round-summary"><div><span>ROUND {activeRound}</span><h3>{activeRound}라운드</h3></div><p><b>{courtCount}개 코트</b> 운영 · {current?.games.length ?? 0}경기 동시 진행</p></div>
      <div className="games-grid">{current?.games.map((g,i)=>{const a=getTeam(g.a),b=getTeam(g.b),savedScore=scores[g.id],draft=draftScores[g.id],done=validScore(savedScore),changed=JSON.stringify(savedScore)!==JSON.stringify(draft);return <article className={`league-match ${done&&!changed?"complete":""}`} key={g.id}><div className="match-head"><span>{i+1}번 코트 · {activeRound}R</span><span>{done&&!changed?"경기 완료":changed?"저장 대기":"점수 입력"}</span></div>{[a,b].map((t,side)=><div className="team-row" key={t.id}><div className="team-name"><b>{t.id}</b><strong>{t.players}</strong></div><input aria-label={`${t.players} 점수`} inputMode="numeric" value={draft?.[side]??""} onChange={e=>changeScore(g.id,side as 0|1,e.target.value)} placeholder="—"/></div>)}{draft?.[0]&&draft[0]===draft[1]&&<p className="error">동점은 저장할 수 없습니다.</p>}<button className={`match-save ${done&&!changed?"saved":""}`} disabled={savingGame===g.id||!changed} onClick={()=>saveMatch(g.id)}>{savingGame===g.id?"저장 중…":done&&!changed?"경기 완료 ✓":done?"수정 결과 저장":"결과 저장"}</button></article>})}</div>
      <div className="round-nav"><button disabled={activeRound===1} onClick={()=>setActiveRound(r=>r-1)}>← 이전 라운드</button><button disabled={activeRound===rounds.length} onClick={()=>setActiveRound(r=>r+1)}>다음 라운드 →</button></div></>:<div className="empty"><strong>리그 설정이 필요합니다.</strong><br/>팀 관리에서 참가 팀과 코트 수를 입력해 주세요.</div>}</section>
    <section id="ranking" className="section ranking-section"><div className="section-title"><div><p>LIVE STANDINGS</p><h2>실시간 리그 순위</h2></div><p className="rule">승·패 〉 승자승 〉 득실차 〉 득점 순</p></div><div className="table-wrap"><table><thead><tr><th>순위</th><th>팀</th><th>경기</th><th>승</th><th>패</th><th>승자승</th><th>득점</th><th>실점</th><th>득실차</th></tr></thead><tbody>{ranking.map((t,i)=><tr key={t.id} className={i===0?"leader":""}><td><b>{i+1}</b></td><td><span className="seed">{t.id}</span><strong>{t.players}</strong></td><td>{t.played}</td><td><b>{t.wins}</b></td><td>{t.losses}</td><td>{t.h2h}</td><td>{t.pf}</td><td>{t.pa}</td><td className={t.pf-t.pa>0?"plus":""}>{t.pf-t.pa>0?"+":""}{t.pf-t.pa}</td></tr>)}</tbody></table></div></section>
    <footer><strong>SHUTTLE CLUB</strong><span>좋은 경기, 멋진 승부를 응원합니다.</span></footer>

    {shuffleAuthOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget){setShuffleAuthOpen(false);setShufflePassword("");setShuffleAuthError(false)}}}><section className="modal" role="dialog" aria-modal="true" aria-label="관리자 인증"><button className="modal-close" onClick={()=>{setShuffleAuthOpen(false);setShufflePassword("");setShuffleAuthError(false)}}>×</button><form className="login" onSubmit={authorizeShuffle}><span className="lock">●</span><p>ADMIN ACCESS</p><h2>{protectedAction==="shuffle"?"경기 섞기":protectedAction==="reset"?"경기 초기화":"대진 재편성"}</h2><label>비밀번호<input autoFocus type="password" value={shufflePassword} onChange={e=>{setShufflePassword(e.target.value);setShuffleAuthError(false)}} placeholder="비밀번호 입력"/></label>{shuffleAuthError&&<small>비밀번호가 올바르지 않습니다.</small>}<button className="primary" type="submit">비밀번호 확인</button></form></section></div>}
    {adminOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAdminOpen(false)}}><section className="modal" role="dialog" aria-modal="true" aria-label="팀 관리자"><button className="modal-close" onClick={()=>setAdminOpen(false)}>×</button>{!authenticated?<form className="login" onSubmit={login}><span className="lock">●</span><p>ADMIN ACCESS</p><h2>관리자 로그인</h2><label>비밀번호<input autoFocus type="password" value={password} onChange={e=>{setPassword(e.target.value);setAuthError(false)}} placeholder="비밀번호 입력"/></label>{authError&&<small>비밀번호가 올바르지 않습니다.</small>}<button className="primary" type="submit">관리자 입장</button></form>:<div className="team-admin"><p>LEAGUE MANAGEMENT</p><h2>리그 운영 관리</h2><div className="court-setting"><div><strong>운영 코트 수</strong><small>라운드당 배치할 최대 경기 수</small></div><div className="court-stepper"><button onClick={()=>setCourtCount(c=>Math.max(1,c-1))}>−</button><input type="number" min="1" max="20" value={courtCount} onChange={e=>setCourtCount(Math.max(1,Math.min(20,Number(e.target.value)||1)))} aria-label="운영 코트 수"/><button onClick={()=>setCourtCount(c=>Math.min(20,c+1))}>+</button></div></div><div className="admin-note">코트 수에 맞춰 라운드별 경기를 자동 배치합니다. 팀을 변경하면 기존 경기 점수가 초기화됩니다.</div><div className="team-list">{teams.map((t,i)=><div className="team-edit" key={t.id}><span>{i+1}</span><input value={t.players} onChange={e=>editTeam(t.id,e.target.value)} aria-label={`${i+1}번 팀 이름`}/><button onClick={()=>deleteTeam(t.id)}>삭제</button></div>)}</div><form className="add-team" onSubmit={addTeam}><input value={newTeam} onChange={e=>setNewTeam(e.target.value)} placeholder="예: 민수 · 철수" aria-label="새 팀 이름"/><button type="submit">+ 팀 추가</button></form><button className="primary save-teams" onClick={persistEdits}>설정 저장 및 대진 편성</button></div>}</section></div>}
  </main>;
}
