import { useState, useRef, useEffect } from "react";
import { X, Check } from "lucide-react";

export interface TagsMultiSelectProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  availableTags?: string[];
  placeholder?: string;
  className?: string;
}

// Predefined common tags for teams
const DEFAULT_TAGS = [
  "defense",
  "shoot-while-moving",
  "ball-pickup",
  "amp-specialist",
  "trap",
  "climber",
  "disabled",
  "inconsistent",
  "no-shooter",
  "strong-driver",
  "weak-driver",
];

export function TagsMultiSelect({
  selectedTags,
  onTagsChange,
  availableTags = DEFAULT_TAGS,
  placeholder = "Add tags...",
  className = "",
}: TagsMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleRemoveTag = (tag: string) => {
    onTagsChange(selectedTags.filter((t) => t !== tag));
  };

  const handleAddCustomTag = () => {
    const trimmed = inputValue.trim().toLowerCase();
    if (trimmed && !selectedTags.includes(trimmed)) {
      onTagsChange([...selectedTags, trimmed]);
      setInputValue("");
    }
  };

  // Filter available tags
  const filteredTags = availableTags.filter(
    (tag) =>
      !selectedTags.includes(tag) &&
      tag.toLowerCase().includes(inputValue.toLowerCase())
  );

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Input field with selected tags */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex flex-wrap gap-2 p-2 min-h-10 rounded-md border border-border bg-card hover:bg-muted/50 cursor-text transition-colors"
      >
        {selectedTags.map((tag) => (
          <div
            key={tag}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 text-primary text-xs font-medium"
          >
            <span>{tag}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveTag(tag);
              }}
              className="hover:bg-primary/30 rounded-full p-0.5"
              title="Remove tag"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddCustomTag();
            }
          }}
          placeholder={selectedTags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-20 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-card shadow-lg overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {filteredTags.length > 0 ? (
              filteredTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleTagToggle(tag)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between"
                >
                  <span>{tag}</span>
                  {selectedTags.includes(tag) && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No tags found
              </div>
            )}

            {/* Custom tag option */}
            {inputValue.trim() && !availableTags.includes(inputValue.trim()) && (
              <button
                onClick={handleAddCustomTag}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors border-t border-border/50 text-primary font-medium"
              >
                + Add "{inputValue.trim()}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
