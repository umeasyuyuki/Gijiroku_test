from fastapi import FastAPI, File, UploadFile, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
import shutil
import json
import requests
import uvicorn
from openai import OpenAI

load_dotenv()

app = FastAPI()

# CORS設定（Reactが http://localhost:3000 で動作している場合）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- 環境変数や直書きでAPIキーなど読み込み
OPENAI_API_KEY = "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"
SUPABASE_URL = "https://taaywqlhffbdvlvfgxez.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhYXl3cWxoZmZiZHZsdmZneGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMzOTYzMzAsImV4cCI6MjA1ODk3MjMzMH0.ZlZRc5o1hF8j8Uo0KsDiXW1C5m4VBdouv-n_ZI3cb7g"
SUPABASE_TABLE = "minute_embeddings"


client = OpenAI(api_key=OPENAI_API_KEY)

class SaveMinutesRequest(BaseModel):
    formatted_transcript: str
    analysis: str
    mindmap: dict
    title: str
# ---------------------------------------------------------
# 議事録生成ロジック
# ---------------------------------------------------------
def generate_minutes_from_text(transcript_text: str) -> dict:
    # 1. GPTで文字起こしを整形
    proofreading_prompt = f"""
    あなたは文字起こしの整形専門アシスタントです。
    以下を文法的に整理し、読みやすく整えてください。
    ・句読点や改行を適切に入れる
    ・冗長な口語表現を削除
    ・ニュアンスや重要な部分を維持

    【文章】
    {transcript_text}
    """
    proofreading_res = client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[{"role": "user", "content": proofreading_prompt}],
        temperature=0.1,
        max_tokens=1500
    )
    formatted_transcript = proofreading_res.choices[0].message.content

    # 2. Embedding & Supabase検索
    emb_res = client.embeddings.create(
        input=[formatted_transcript],
        model="text-embedding-ada-002"
    )
    query_embedding = emb_res.data[0].embedding

    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }
    rpc_payload = {
        "query_embedding": query_embedding,
        "match_threshold": 0.2,
        "match_count": 5
    }
    rpc = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/match_minutes",
        headers=headers,
        json=rpc_payload
    )
    matched_minutes = rpc.json()

    if isinstance(matched_minutes, list):
        if matched_minutes and isinstance(matched_minutes[0], dict):
            past_analysis_texts = "\n\n".join(
                m.get("analysis", "") for m in matched_minutes
            )
        else:
            past_analysis_texts = ""
    else:
        raise ValueError("Supabase RPC match_minutes の戻り値が想定外")

    # 3. GPTで最終議事録生成
    analysis_prompt = f"""
    あなたは企業の戦略会議を専門とする高度な議事録作成アシスタントです。

    【過去の議事録（参照用）】
    {past_analysis_texts}

    【今回の会議内容】
    {formatted_transcript}

    上記を踏まえて、以下の項目を詳細にまとめてください。

    ■タイトル（この会議を一言で表すキャッチーなタイトル）
    ■会議サマリー（全体概要を3〜5行程度）
    ■決定事項（明確に箇条書き）
    ■課題・懸念点（未解決事項を箇条書き）
    ■今後の方針・アクションプラン（具体的に担当者と期限を明記）
    ■要因分析（課題や成功/失敗要因を明確に分析）
    ■事実と解釈の仕分け（事実情報と主観的解釈を分離して整理）

    出力は以下のJSON形式のみで返してください()：

    {{
        "タイトル": "この会議のタイトル",
        "議事録": "サマリー、決定事項、課題・懸念点、今後の方針・アクションプラン、要因分析、事実と解釈の仕分けを含む本文",
        "改善案": "過去データを踏まえた具体的改善案",
        "マインドマップ": {{
            "name": "会議",
            "children": [
                {{
                    "name": "議題",
                    "children": [
                        {{
                            "name": "課題",
                            "children": [{{"name": "原因・背景"}}, {{"name": "原因2"}}]
                        }},
                        {{
                            "name": "改善案",
                            "children": [{{"name": "提案1"}}, {{"name": "提案2"}}]
                        }}
                    ]
                }}
            ]
        }}
    }}
    """
    analysis_res = client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[{"role": "user", "content": analysis_prompt}],
        temperature=0.2,
        max_tokens=2000
    )
    analysis_raw = analysis_res.choices[0].message.content.strip()
    analysis_json = json.loads(analysis_raw)

    return {
        "formatted_transcript": formatted_transcript,
        "title": analysis_json["タイトル"],
        "analysis": analysis_json["議事録"],
        "improvement": analysis_json["改善案"],
        "mindmap": analysis_json["マインドマップ"]
    }

# ---------------------------------------------------------
# 3) 音声チャンクまとめて議事録
# ---------------------------------------------------------
@app.post("/transcribe-chunks")
async def transcribe_chunks(audios: list[UploadFile] = File(...)):
    """
    複数の音声チャンク(ogg/webm)を受け取り、Whisperで文字起こし→連結→議事録生成
    """
    combined_transcript = ""
    for idx, audio in enumerate(audios):
        # ファイル名から拡張子を取得
        base_name, ext = os.path.splitext(audio.filename)
        if not ext:
            # デフォルトは .webm で
            ext = ".webm"

        temp_path = f"./temp_audio_part_{idx}{ext}"
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)

        # Whisperで文字起こし
        with open(temp_path, "rb") as f_in:
            res = client.audio.transcriptions.create(
                model="whisper-1",
                file=f_in
            )
        partial_transcript = res.text
        combined_transcript += partial_transcript + "\n"

        os.remove(temp_path)

    if not combined_transcript.strip():
        raise HTTPException(status_code=400, detail="音声チャンクがありませんでした。")

    return generate_minutes_from_text(combined_transcript)

# ---------------------------------------------------------
# 4) テキスト議事録
# ---------------------------------------------------------
@app.post("/transcribe-text")
async def transcribe_text(payload: dict):
    raw_text = payload.get("raw_text", "")
    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="テキストが空です")

    return generate_minutes_from_text(raw_text)

# ---------------------------------------------------------
# 5) 議事録保存
# ---------------------------------------------------------
@app.post("/save-minutes")
async def save_minutes(data: SaveMinutesRequest):
    emb_res = client.embeddings.create(
        input=[data.formatted_transcript],
        model="text-embedding-ada-002"
    )
    embedding_vector = emb_res.data[0].embedding

    payload = data.dict()
    payload["embedding"] = embedding_vector

    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}",
        headers=headers,
        json=payload
    )
    if r.status_code in [200, 201, 204]:
        return {"status": "success"}
    else:
        return {"status": "error", "detail": r.text, "code": r.status_code}

# ---------------------------------------------------------
# 6) 保存済み議事録一覧
# ---------------------------------------------------------
@app.get("/get-minutes")
async def get_minutes():
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
    }
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?select=*",
        headers=headers
    )
    if r.status_code in [200, 201, 204]:
        return {"minutes": r.json()}
    else:
        return {"status": "error", "detail": r.text, "code": r.status_code}

# ---------------------------------------------------------
# 7) 議事録削除
# ---------------------------------------------------------
@app.delete("/delete-minutes/{minute_id}")
async def delete_minutes(minute_id: str):
    """
    Supabaseの id=minute_id レコードを削除
    """
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?id=eq.{minute_id}"
    r = requests.delete(url, headers=headers)
    if r.status_code in [200, 204]:
        return {"status": "success"}
    else:
        return {"status": "error", "detail": r.text, "code": r.status_code}

# ---------------------------------------------------------
# 8) チャットボット: /chatbot
# ---------------------------------------------------------
@app.post("/chatbot")
async def chatbot_query(payload: dict):
    user_message = payload.get("message", "")
    if not user_message.strip():
        raise HTTPException(status_code=400, detail="メッセージが空です")

    # 1) Embedding
    user_emb = client.embeddings.create(
        input=[user_message],
        model="text-embedding-ada-002"
    )
    user_query_vector = user_emb.data[0].embedding

    # 2) Supabaseで検索
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }
    rpc_payload = {
        "query_embedding": user_query_vector,
        "match_threshold": 0.2,
        "match_count": 5
    }
    rpc_resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/match_minutes",
        headers=headers,
        json=rpc_payload
    )
    matched_minutes = rpc_resp.json()

    if isinstance(matched_minutes, list) and len(matched_minutes) > 0:
        if isinstance(matched_minutes[0], dict):
            retrieved_texts = "\n\n".join(item.get("analysis", "") for item in matched_minutes)
        else:
            retrieved_texts = ""
    else:
        retrieved_texts = ""

    # 3) GPT応答
    system_prompt = """
    あなたは社内議事録のデータベースを参照できるAIアシスタントです。
    ユーザーの質問に対して、議事録データに基づき、できるだけ具体的に回答してください。
    必要に応じて推測も構いませんが、事実と推測は分けて表現してください。
    """
    user_prompt = f"""
    【過去の議事録抜粋】
    {retrieved_texts}

    【ユーザーからの質問】
    {user_message}

    上記情報を踏まえて、簡潔かつ具体的に回答してください:
    """

    gpt_res = client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.7,
        max_tokens=800
    )
    answer_text = gpt_res.choices[0].message.content.strip()

    return {"response": answer_text}


# ---------------------------------------------------------
# メイン起動
# ---------------------------------------------------------
if __name__ == '__main__':
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)