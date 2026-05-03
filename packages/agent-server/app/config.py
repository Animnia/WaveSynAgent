"""Configuration for the agent server."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server
    host: str = "0.0.0.0"
    port: int = 3002

    # API Server (Node.js backend)
    api_server_url: str = "http://localhost:3001"

    # LLM Providers
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-20250514"

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-pro"

    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    dashscope_model: str = "qwen-max"

    # Default provider
    default_provider: str = "openai"

    # Agent limits
    max_tool_calls_per_turn: int = 10
    max_turns: int = 20

    model_config = {"env_file": "../../.env", "extra": "ignore"}


settings = Settings()
