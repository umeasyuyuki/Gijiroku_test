import React, { useState, useEffect, useRef } from 'react';
import Tree from 'react-d3-tree';

// ======== MUIコンポーネント & フレームワーク =========
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Box,
  Paper,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
  IconButton
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

// ======== Framer Motion for Animations =========
import { motion, AnimatePresence } from 'framer-motion';

// ======== アイコン =========
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';

/**
 * テーマを作成（都会的なブルー×ホワイト＋やや近未来感）
 */
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2', // MaterialUI既定のブルー
    },
    secondary: {
      main: '#00f2fe', // 近未来ぽいライトブルー
    },
  },
  typography: {
    fontFamily: [
      'Montserrat',
      'Playfair Display',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
});

/**
 * アニメーション用のバリアント例
 */
const fadeInVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};
const popInVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.4 } },
};

function App() {
  const API_URL = "http://localhost:8000";

  // --------------------------
  // ステート類（議事録作成部分）
  // --------------------------
  const [notes, setNotes] = useState('ここに文字起こしが表示されます');
  const [summary, setSummary] = useState('ここに議事録・改善案が表示されます');
  const [mindmapData, setMindmapData] = useState(null);
  const [title, setTitle] = useState('');

  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const [savedMinutes, setSavedMinutes] = useState([]);
  const [selectedMinute, setSelectedMinute] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 録音関連
  const mediaRecorderRef = useRef(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [recordingTimerId, setRecordingTimerId] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const durationIntervalRef = useRef(null);

  // --------------------------
  // モード: audio | text | chat
  // --------------------------
  const [mode, setMode] = useState("audio");
  const [inputTranscript, setInputTranscript] = useState("");

  // --------------------------
  // チャットモード用
  // --------------------------
  const [chatMessages, setChatMessages] = useState([]); // { sender:'user'|'bot', text:''}[]
  const [chatInput, setChatInput] = useState("");

  // --------------------------
  // 1) 保存済み議事録を取得
  // --------------------------
  const fetchSavedMinutes = async () => {
    try {
      const res = await fetch(`${API_URL}/get-minutes`);
      if (!res.ok) throw new Error('保存された議事録の取得に失敗しました');
      const data = await res.json();
      const sorted = data.minutes.sort((a, b) => b.id - a.id);
      setSavedMinutes(sorted);
    } catch (error) {
      console.error('Error fetching saved minutes:', error);
    }
  };

  useEffect(() => {
    fetchSavedMinutes();
  }, []);

  /**
   * ブラウザがサポートする録音mimeTypeを順に探す
   */
  function getSupportedMimeType() {
    const possibleTypes = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/ogg"
    ];
    for (const t of possibleTypes) {
      if (MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return "";
  }

  // ====================================================
  // 録音開始（フォールバックで対応フォーマットを選ぶ）
  // ====================================================
  const startRecording = async () => {
    setRecording(true);
    setRecorded(false);
    setAudioChunks([]);
    setRecordingDuration(0);
    setNotes('録音が開始されました');
    setSummary('会議中...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        throw new Error("ブラウザがサポートする録音フォーマットがありません。");
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      let localChunks = [];
      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) {
          localChunks.push(e.data);
        }
      });

      mediaRecorder.addEventListener("stop", () => {
        // 取得したmimeTypeから拡張子を推定
        let fileExt = mimeType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(localChunks, { type: mimeType });
        // Fileにして名前をつけておく
        const file = new File([blob], `recording_part.${fileExt}`, { type: mimeType });
        setAudioChunks(prev => [...prev, file]);
        localChunks = [];
      });

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();

      // 10分ごとに stop -> start
      const chunkInterval = setInterval(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
        let newLocalChunks = [];
        mediaRecorder.addEventListener("dataavailable", e => {
          if (e.data.size > 0) {
            newLocalChunks.push(e.data);
          }
        });
        mediaRecorder.addEventListener("stop", () => {
          let fileExt = mimeType.includes("ogg") ? "ogg" : "webm";
          const newBlob = new Blob(newLocalChunks, { type: mimeType });
          const file = new File([newBlob], `recording_part.${fileExt}`, { type: mimeType });
          setAudioChunks(prev => [...prev, file]);
        });
        mediaRecorder.start();
      }, 600000);

      setRecordingTimerId(chunkInterval);

      // 経過時間カウンタ
      const timer = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      durationIntervalRef.current = timer;

    } catch (err) {
      console.error('録音開始失敗:', err);
      setNotes('録音開始に失敗しました: ' + err.message);
      setRecording(false);
    }
  };

  // ====================================================
  // 録音停止 & 自動議事録作成
  // ====================================================
  const stopRecording = async () => {
    setRecording(false);
    setRecorded(true);

    if (recordingTimerId) {
      clearInterval(recordingTimerId);
      setRecordingTimerId(null);
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    setNotes('録音が停止しました。文字起こしを準備中...');

    setTimeout(() => {
      sendChunksToServer();
    }, 500);
  };

  // ====================================================
  // 複数チャンク送信 → 議事録生成
  // ====================================================
  const sendChunksToServer = async () => {
    if (!audioChunks || audioChunks.length === 0) {
      console.warn('音声チャンクがありません');
      return;
    }
    try {
      setLoading(true);
      const formData = new FormData();
      audioChunks.forEach((file, index) => {
        formData.append('audios', file, file.name || `recording_part_${index}.webm`);
      });

      const res = await fetch(`${API_URL}/transcribe-chunks`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`サーバーエラー: ${res.statusText}`);

      const data = await res.json();
      setNotes(data.formatted_transcript);
      setSummary(data.analysis);
      setMindmapData(data.mindmap);
      setTitle(data.title);

      setAudioChunks([]);
    } catch (error) {
      console.error('通信エラー:', error);
      setNotes('通信エラーが発生しました（ファイルサイズ制限などの可能性あり）');
    } finally {
      setLoading(false);
    }
  };

  // ====================================================
  // テキストモード: 議事録作成
  // ====================================================
  const sendTextToServer = async () => {
    if (!inputTranscript.trim()) {
      alert("テキストが空です。");
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/transcribe-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: inputTranscript }),
      });
      if (!res.ok) throw new Error(`サーバーエラー: ${res.statusText}`);

      const data = await res.json();
      setNotes(data.formatted_transcript);
      setSummary(data.analysis);
      setMindmapData(data.mindmap);
      setTitle(data.title);

      setRecorded(true);
    } catch (err) {
      console.error('テキストモード失敗:', err);
      setNotes('テキスト議事録の生成中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // ====================================================
  // 議事録保存
  // ====================================================
  const saveToDatabase = async () => {
    try {
      const res = await fetch(`${API_URL}/save-minutes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formatted_transcript: notes,
          analysis: summary,
          mindmap: mindmapData,
          title: title,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`保存に失敗しました: ${errorText}`);
      }
      const result = await res.json();
      if (result.status === 'success') {
        setSaveStatus('保存が完了しました！');
        setShowSaveModal(false);
        fetchSavedMinutes();
      } else {
        setSaveStatus('保存に失敗しました: ' + (result.detail || ''));
      }
    } catch (err) {
      console.error('保存失敗:', err);
      setSaveStatus(err.message || '保存中にエラーが発生しました');
    }
  };

  // ====================================================
  // 議事録削除
  // ====================================================
  const deleteMinutes = async (id) => {
    if (!window.confirm("本当に削除しますか？")) return;
    try {
      const res = await fetch(`${API_URL}/delete-minutes/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`削除に失敗しました: ${errorText}`);
      }
      const result = await res.json();
      if (result.status === 'success') {
        alert('削除しました');
        fetchSavedMinutes();
        if (selectedMinute && selectedMinute.id === id) {
          setSelectedMinute(null);
        }
      } else {
        alert('削除に失敗: ' + result.detail);
      }
    } catch (err) {
      console.error('削除エラー:', err);
      alert('削除中にエラーが発生しました');
    }
  };

  // ====================================================
  // コピー機能
  // ====================================================
  const handleCopyContent = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
      alert('コピーしました!');
    } catch (err) {
      console.error('コピー失敗:', err);
      alert('コピーに失敗しました');
    }
  };

  // ====================================================
  // チャットモード: 質問送信
  // ====================================================
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    // ユーザーメッセージを追加
    const userMsg = { sender: 'user', text: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");

    try {
      const res = await fetch(`${API_URL}/chatbot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.text }),
      });
      if (!res.ok) {
        throw new Error(`サーバーエラー: ${res.statusText}`);
      }
      const data = await res.json();
      const botMsg = { sender: 'bot', text: data.response };
      setChatMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error("チャットbotエラー:", err);
      const botMsg = { sender: 'bot', text: "エラーが発生しました。" };
      setChatMessages((prev) => [...prev, botMsg]);
    }
  };

  // --------------------------
  // モーダル & サイドバー
  // --------------------------
  const closeSaveModal = () => {
    setSaveStatus(null);
  };
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          minHeight: '100vh',
          background: 'linear-gradient(to bottom right, #f0f9ff, #cfe9ff, #eef6ff)',
          position: 'relative',
        }}
      >
        {/* サイドバー閉開ボタン */}
        <Button
          variant="contained"
          color="primary"
          onClick={toggleSidebar}
          sx={{
            position: 'absolute',
            left: 10,
            top: 20,
            borderRadius: '50%',
            width: 45,
            minWidth: 45,
            height: 45,
            fontSize: '1rem',
            zIndex: 2000,
          }}
        >
          {sidebarOpen ? '←' : '→'}
        </Button>

        {/* ヘッダー */}
        <AppBar position="sticky" sx={{ bgcolor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(8px)' }}>
          <Toolbar sx={{ justifyContent: 'center' }}>
            <Typography variant="h4" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
              Conect AI
            </Typography>
          </Toolbar>
        </AppBar>

        {/* サイドバー */}
        <Drawer
          variant="persistent"
          anchor="left"
          open={sidebarOpen}
          sx={{
            '& .MuiDrawer-paper': {
              width: 240,
              boxSizing: 'border-box',
              borderRight: '1px solid #eee',
              bgcolor: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(6px)',
              pt: 8,
            },
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold', color: '#1976d2' }}>
              保存した議事録
            </Typography>
            <List>
              {savedMinutes.length > 0 ? (
                savedMinutes.map((minute) => (
                  <ListItemButton
                    key={minute.id}
                    onClick={() => {
                      setSelectedMinute(minute);
                      setShowSaveModal(false);
                    }}
                  >
                    <ListItemText primary={minute.title} />
                  </ListItemButton>
                ))
              ) : (
                <ListItemButton>
                  <ListItemText primary="保存された議事録はありません" />
                </ListItemButton>
              )}
            </List>
          </Box>
        </Drawer>

        {/* メイン表示 */}
        <Box
          sx={{
            ml: sidebarOpen ? '240px' : 2,
            p: 3,
            pt: 10,
            transition: 'margin-left 0.3s ease',
          }}
        >
          {/* モード切り替え */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mb: 3 }}>
            <Button
              variant={mode === 'audio' ? 'contained' : 'outlined'}
              sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
              onClick={() => setMode('audio')}
            >
              音声モード
            </Button>
            <Button
              variant={mode === 'text' ? 'contained' : 'outlined'}
              sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
              onClick={() => setMode('text')}
            >
              テキストモード
            </Button>
            <Button
              variant={mode === 'chat' ? 'contained' : 'outlined'}
              sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
              onClick={() => setMode('chat')}
            >
              チャットモード
            </Button>
          </Box>

          <AnimatePresence>
            {selectedMinute ? (
              // 議事録詳細表示
              <motion.div
                key="detailView"
                variants={fadeInVariants}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
                style={{ position: 'relative' }}
              >
                <Button
                  variant="contained"
                  onClick={() => setSelectedMinute(null)}
                  sx={{
                    position: 'absolute',
                    left: 10,
                    top: 10,
                    borderRadius: 3,
                    px: 4,
                    py: 1,
                    fontWeight: 'bold',
                    zIndex: 1000,
                  }}
                >
                  戻る
                </Button>

                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 'bold',
                    color: 'primary.main',
                    textAlign: 'center',
                    mb: 4,
                  }}
                >
                  {selectedMinute.title}
                </Typography>

                {/* 整形された文字起こし */}
                <Paper sx={{ p: 3, mb: 3, position: 'relative', borderRadius: 3 }}>
                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 'bold',
                      color: 'secondary.main',
                      mb: 2,
                      fontSize: '1.2rem',
                    }}
                  >
                    整形された文字起こし
                  </Typography>
                  <IconButton
                    size="small"
                    sx={{ position: 'absolute', top: 8, right: 8 }}
                    onClick={() => handleCopyContent(selectedMinute.formatted_transcript)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                  <Typography
                    variant="body1"
                    sx={{
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      lineHeight: 1.6,
                    }}
                  >
                    {selectedMinute.formatted_transcript}
                  </Typography>
                </Paper>

                {/* 議事録・改善案 */}
                <Paper sx={{ p: 3, mb: 3, position: 'relative', borderRadius: 3 }}>
                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 'bold',
                      color: 'secondary.main',
                      mb: 2,
                      fontSize: '1.2rem',
                    }}
                  >
                    議事録・改善案
                  </Typography>
                  <IconButton
                    size="small"
                    sx={{ position: 'absolute', top: 8, right: 8 }}
                    onClick={() => handleCopyContent(selectedMinute.analysis)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                  <Typography
                    variant="body1"
                    sx={{
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      lineHeight: 1.6,
                    }}
                  >
                    {selectedMinute.analysis}
                  </Typography>
                </Paper>

                {/* マインドマップ */}
                {selectedMinute.mindmap && (
                  <Paper sx={{ p: 3, mb: 3, borderRadius: 3 }}>
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 'bold',
                        color: 'secondary.main',
                        mb: 2,
                        fontSize: '1.2rem',
                      }}
                    >
                      マインドマップ
                    </Typography>
                    <Box
                      sx={{
                        border: '1px solid #ccc',
                        borderRadius: 2,
                        height: '600px',
                        overflow: 'auto',
                      }}
                    >
                      <Tree
                        data={selectedMinute.mindmap}
                        orientation="vertical"
                        pathFunc="diagonal"
                        translate={{ x: 400, y: 50 }}
                        separation={{ siblings: 1.5, nonSiblings: 2 }}
                        nodeSize={{ x: 300, y: 100 }}
                      />
                    </Box>
                  </Paper>
                )}

                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => deleteMinutes(selectedMinute.id)}
                    sx={{
                      borderRadius: 3,
                      px: 4,
                      py: 1,
                      fontWeight: 'bold',
                    }}
                  >
                    この議事録を削除
                  </Button>
                </Box>
              </motion.div>
            ) : (
              <motion.div
                key={mode}
                variants={fadeInVariants}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
              >
                {mode === "audio" && (
                  <Paper sx={{ p: 4, mb: 4, borderRadius: 3 }} elevation={3}>
                    <Typography
                      variant="h5"
                      sx={{
                        textAlign: 'center',
                        mb: 3,
                        color: 'primary.main',
                        fontWeight: 'bold',
                      }}
                    >
                      音声モード
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      {!recording ? (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={startRecording}
                          sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
                        >
                          録音開始
                        </Button>
                      ) : (
                        <Button
                          variant="contained"
                          color="secondary"
                          onClick={stopRecording}
                          sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
                        >
                          録音停止
                        </Button>
                      )}
                      {recording && (
                        <Typography variant="body1" sx={{ mt: 1, fontWeight: 'bold', fontSize: '1rem' }}>
                          録音中... {Math.floor(recordingDuration / 60)}分 {recordingDuration % 60}秒
                        </Typography>
                      )}
                    </Box>
                  </Paper>
                )}

                {mode === "text" && (
                  <Paper sx={{ p: 4, mb: 4, borderRadius: 3 }} elevation={3}>
                    <Typography
                      variant="h5"
                      sx={{
                        textAlign: 'center',
                        mb: 3,
                        color: 'primary.main',
                        fontWeight: 'bold',
                      }}
                    >
                      テキストモード
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <TextField
                        fullWidth
                        multiline
                        rows={4}
                        variant="outlined"
                        size="small"
                        sx={{ maxWidth: '600px', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: 2 }}
                        value={inputTranscript}
                        onChange={(e) => setInputTranscript(e.target.value)}
                        placeholder="ここにテキストを貼り付けてください"
                      />
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={sendTextToServer}
                        sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
                      >
                        議事録生成
                      </Button>
                    </Box>
                  </Paper>
                )}

                {mode === "chat" && (
                  <Paper sx={{ p: 4, mb: 4, borderRadius: 3 }} elevation={3}>
                    <Typography
                      variant="h5"
                      sx={{
                        textAlign: 'center',
                        mb: 3,
                        color: 'primary.main',
                        fontWeight: 'bold',
                      }}
                    >
                      チャットモード (GPT風UI)
                    </Typography>

                    {/* GPT風チャットエリア */}
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '500px',
                        maxWidth: '700px',
                        margin: '0 auto',
                        border: '1px solid #ccc',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      {/* メッセージ表示エリア */}
                      <Box
                        sx={{
                          flex: 1,
                          overflowY: 'auto',
                          p: 2,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                          backgroundColor: '#fdfdfd',
                        }}
                      >
                        {chatMessages.map((msg, idx) => (
                          <Box
                            key={idx}
                            sx={{
                              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                              maxWidth: '80%',
                            }}
                          >
                            <Paper
                              sx={{
                                p: 1.5,
                                my: 0.5,
                                borderRadius: 2,
                                backgroundColor: msg.sender === 'user' ? '#e3f2fd' : '#ffffff',
                                boxShadow: 2,
                              }}
                            >
                              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', fontSize: '1rem' }}>
                                {msg.text}
                              </Typography>
                            </Paper>
                          </Box>
                        ))}
                      </Box>

                      {/* 入力部 */}
                      <Box
                        sx={{
                          borderTop: '1px solid #ccc',
                          p: 2,
                          display: 'flex',
                          gap: 1,
                          backgroundColor: '#f0f0f0',
                        }}
                      >
                        <TextField
                          variant="outlined"
                          size="small"
                          fullWidth
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="質問を入力...(Enterで改行。送信はボタン)"
                          sx={{ borderRadius: 2 }}
                          multiline
                          rows={2}
                        />
                        <Button
                          variant="contained"
                          onClick={sendChatMessage}
                          sx={{ borderRadius: 3, px: 2, py: 1, fontWeight: 'bold', alignSelf: 'end' }}
                        >
                          送信
                        </Button>
                      </Box>
                    </Box>
                  </Paper>
                )}

                {/* 生成結果 (audio/text時) */}
                {(recorded && notes && (mode === "audio" || mode === "text")) && (
                  <motion.div
                    key="generatedView"
                    variants={popInVariants}
                    initial="hidden"
                    animate="visible"
                    exit={{ opacity: 0 }}
                  >
                    <Paper sx={{ p: 4, mb: 4, borderRadius: 3 }} elevation={2}>
                      <Typography
                        variant="h5"
                        sx={{
                          mb: 3,
                          color: 'primary.main',
                          fontWeight: 'bold',
                          textAlign: 'center',
                        }}
                      >
                        生成された議事録（編集可能）
                      </Typography>

                      <Box sx={{ position: 'relative', mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, fontSize: '1.2rem' }}>
                          タイトル:
                        </Typography>
                        <IconButton
                          size="small"
                          sx={{ position: 'absolute', top: 30, right: 10 }}
                          onClick={() => handleCopyContent(title)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                        <TextField
                          fullWidth
                          variant="outlined"
                          size="small"
                          sx={{ mt: 1 }}
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </Box>

                      <Box sx={{ position: 'relative', mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, fontSize: '1.2rem' }}>
                          文字起こし:
                        </Typography>
                        <IconButton
                          size="small"
                          sx={{ position: 'absolute', top: 30, right: 10 }}
                          onClick={() => handleCopyContent(notes)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                        <TextField
                          fullWidth
                          multiline
                          rows={4}
                          variant="outlined"
                          size="small"
                          sx={{ mt: 1 }}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </Box>

                      <Box sx={{ position: 'relative', mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, fontSize: '1.2rem' }}>
                          議事録・改善案:
                        </Typography>
                        <IconButton
                          size="small"
                          sx={{ position: 'absolute', top: 30, right: 10 }}
                          onClick={() => handleCopyContent(summary)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                        <TextField
                          fullWidth
                          multiline
                          rows={4}
                          variant="outlined"
                          size="small"
                          sx={{ mt: 1 }}
                          value={summary}
                          onChange={(e) => setSummary(e.target.value)}
                        />
                      </Box>

                      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                        <Button
                          variant="contained"
                          onClick={() => setShowSaveModal(true)}
                          sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
                        >
                          確認画面へ
                        </Button>
                      </Box>
                    </Paper>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Box>

        {/* 保存モーダル */}
        <Dialog open={showSaveModal} onClose={() => setShowSaveModal(false)} fullWidth maxWidth="md">
          <DialogTitle>この内容で保存します</DialogTitle>
          <DialogContent dividers>
            <DialogContentText>
              <strong>タイトル:</strong> {title}
            </DialogContentText>
            <DialogContentText>
              <strong>文字起こし:</strong> {notes}
            </DialogContentText>
            <DialogContentText>
              <strong>議事録・改善案:</strong> {summary}
            </DialogContentText>
            {mindmapData && (
              <Box sx={{ border: '1px solid #ccc', p: 2, borderRadius: 2, mt: 2 }}>
                <Tree
                  data={mindmapData}
                  orientation="vertical"
                  translate={{ x: 350, y: 50 }}
                  pathFunc="diagonal"
                  separation={{ siblings: 1.5, nonSiblings: 2 }}
                  nodeSize={{ x: 300, y: 100 }}
                />
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'center' }}>
            <Button
              onClick={saveToDatabase}
              variant="contained"
              sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
            >
              この内容で保存する
            </Button>
            <Button
              onClick={() => setShowSaveModal(false)}
              variant="outlined"
              sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
            >
              閉じる
            </Button>
          </DialogActions>
        </Dialog>

        {/* ローディング */}
        <Dialog open={loading} maxWidth="xs">
          <DialogContent sx={{ textAlign: 'center' }}>
            <CircularProgress />
            <DialogContentText sx={{ mt: 2 }}>
              議事録を生成中です...お待ちください
            </DialogContentText>
          </DialogContent>
        </Dialog>

        {/* 保存結果モーダル */}
        <Dialog open={Boolean(saveStatus)} onClose={closeSaveModal} maxWidth="xs">
          <DialogContent>
            <DialogContentText>{saveStatus}</DialogContentText>
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'center' }}>
            <Button
              onClick={closeSaveModal}
              variant="contained"
              sx={{ borderRadius: 3, px: 4, py: 1, fontWeight: 'bold' }}
            >
              閉じる
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

export default App;