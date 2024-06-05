import uvicorn


def main() -> None:
    """Start PhotoStudio server plug-and-play."""
    print("Hello! Starting PhotoStudio on http://127.0.0.1:8000 ...")
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
