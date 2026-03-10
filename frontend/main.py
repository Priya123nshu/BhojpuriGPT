"""
Bhojpuri GPT — FastAPI Backend
Loads a base gpt2-large model and a PEFT LoRA adapter, serving text generation via API.
"""

import os
import torch
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from transformers import GPT2LMHeadModel, PreTrainedTokenizerFast
from peft import PeftModel

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
model = None
tokenizer = None
DEVICE: str = "cpu"

# Base model identifier (Hugging Face Hub)
BASE_MODEL_ID = "gpt2-large"

# ---------------------------------------------------------------------------
# Lifespan — load model once on startup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, tokenizer, DEVICE

    if os.environ.get("MOCK_MODEL") == "1":
        print("⚠️ Running in MOCK mode. Model will NOT be loaded.")
        yield
        return

    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"⚡ Loading model on {DEVICE} …")

    # Load tokenizer from local adapter directory (it contains custom tokens/merges if any)
    print("Loading tokenizer...")
    tokenizer = PreTrainedTokenizerFast(tokenizer_file=os.path.join(MODEL_DIR, "tokenizer.json"))
    tokenizer.pad_token = tokenizer.eos_token

    # Load the base model
    print(f"Loading base model ({BASE_MODEL_ID})...")
    base_model = GPT2LMHeadModel.from_pretrained(BASE_MODEL_ID)

    # Load the PEFT adapter
    print(f"Loading PEFT adapter from {MODEL_DIR}...")
    model = PeftModel.from_pretrained(base_model, MODEL_DIR)
    
    model.to(DEVICE)
    model.eval()

    print("✅ Model loaded successfully!")
    yield  # app runs here
    print("🛑 Shutting down …")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Bhojpuri GPT Model API",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------
class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2048, description="Input prompt text")
    max_length: int = Field(60, ge=10, le=1024, description="Maximum total tokens to generate")
    temperature: float = Field(0.7, ge=0.1, le=2.0, description="Sampling temperature")
    top_p: float = Field(0.9, ge=0.1, le=1.0, description="Nucleus sampling probability")
    top_k: int = Field(50, ge=1, le=500, description="Top-k sampling")


class GenerateResponse(BaseModel):
    prompt: str
    generated_text: str
    tokens_generated: int


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "device": DEVICE,
    }


@app.post("/api/generate", response_model=GenerateResponse)
async def generate_text(req: GenerateRequest):
    if os.environ.get("MOCK_MODEL") == "1":
        return GenerateResponse(
            prompt=req.prompt,
            generated_text="[MOCK] This is a mocked response to save time during development.",
            tokens_generated=10,
        )

    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    try:
        inputs = tokenizer(req.prompt, return_tensors="pt", truncation=True, max_length=512)
        input_ids = inputs["input_ids"].to(DEVICE)
        attention_mask = inputs["attention_mask"].to(DEVICE)

        with torch.no_grad():
            output_ids = model.generate(
                input_ids,
                attention_mask=attention_mask,
                max_length=req.max_length,
                temperature=req.temperature,
                top_p=req.top_p,
                top_k=req.top_k,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id,
                no_repeat_ngram_size=3,
            )

        full_text = tokenizer.decode(output_ids[0], skip_special_tokens=True)
        generated_text = full_text[len(req.prompt):].strip() if full_text.startswith(req.prompt) else full_text.strip()
        tokens_generated = output_ids.shape[1] - input_ids.shape[1]

        return GenerateResponse(
            prompt=req.prompt,
            generated_text=generated_text,
            tokens_generated=tokens_generated,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")


# ---------------------------------------------------------------------------
# Serve frontend static files
# ---------------------------------------------------------------------------
STATIC_DIR = os.path.join(MODEL_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)


@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, reload_excludes=["static", "*.html", "*.css", "*.js"])
