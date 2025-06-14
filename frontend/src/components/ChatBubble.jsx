export default function ChatBubble({ role, text }) {
  const isUser = role === "user";
  return (
    <div
      className={`max-w-xl p-3 rounded-lg whitespace-pre-wrap break-words ${
        isUser
          ? "ml-auto bg-blue-100 border-l-4 border-blue-500 dark:bg-blue-900/40"
          : "mr-auto bg-green-100 border-l-4 border-green-500 dark:bg-green-900/40"
      }`}
    >
      {text}
    </div>
  );
}
