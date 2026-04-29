const FRAMES = ["|", "/", "-", "\\"];

type LoaderOptions<T> = {
  start: string;
  success?: string | ((result: T) => string);
  fail?: string;
};

export const withLoader = async <T>(
  task: () => Promise<T>,
  options: LoaderOptions<T>,
): Promise<T> => {
  const stream = process.stderr;
  const interactive = !!stream.isTTY;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | undefined;

  const render = (message: string) => {
    if (interactive) {
      stream.write(`\r${message}`);
      return;
    }

    stream.write(`${message}\n`);
  };

  if (interactive) {
    render(`${FRAMES[frameIndex]} ${options.start}`);
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % FRAMES.length;
      render(`${FRAMES[frameIndex]} ${options.start}`);
    }, 80);
  } else {
    render(options.start);
  }

  try {
    const result = await task();
    const successMessage =
      typeof options.success === "function"
        ? options.success(result)
        : options.success;

    if (timer) {
      clearInterval(timer);
    }

    if (interactive) {
      stream.write("\r");
      stream.write(" ".repeat(options.start.length + 4));
      stream.write("\r");
    }

    if (successMessage) {
      stream.write(`${successMessage}\n`);
    }

    return result;
  } catch (error) {
    if (timer) {
      clearInterval(timer);
    }

    if (interactive) {
      stream.write("\r");
      stream.write(" ".repeat(options.start.length + 4));
      stream.write("\r");
    }

    if (options.fail) {
      stream.write(`${options.fail}\n`);
    }

    throw error;
  }
};
