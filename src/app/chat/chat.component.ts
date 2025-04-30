import { HttpClient } from "@angular/common/http";
import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, Auth } from "firebase/auth";
import { firebaseConfig } from "../firebase.config";
import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  HostListener,
} from "@angular/core";

interface NutrientData {
  key: string;
  label: string;
  unit: string;
  color: string;
  consumed: number;
  goal: number;
  left: number;
  percent: number;
}

@Component({
  selector: "app-chat",
  templateUrl: "./chat.component.html",
  styleUrls: ["./chat.component.scss"],
})
export class ChatComponent implements OnInit {
  app: FirebaseApp;
  auth: Auth;
  uid: string = "";
  userInput: string = "";
  messages: any[] = [];
  isTyping = false;
  theme: "light" | "dark" = "light";

  previewUrl: string | null = null;
  capturedImage: string | null = null;
  showCamera = false;
  displayedNutrients: NutrientData[] = [];
  isLoadingGoal = false;
  showGoalSummary = false;

  @ViewChild("fileInput") fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild("video") video!: ElementRef<HTMLVideoElement>;
  @ViewChild("canvas") canvas!: ElementRef<HTMLCanvasElement>;

  constructor(private http: HttpClient) {
    this.app = initializeApp(firebaseConfig);
    this.auth = getAuth(this.app);
  }

  ngOnInit(): void {
    this.theme = (localStorage.getItem("theme") as "light" | "dark") || "light";
    document.body.className = `${this.theme}-mode`;

    signInAnonymously(this.auth).then((userCredential: any) => {
      this.uid = userCredential.user.uid;
    });
  }

  sendMessage(): void {
    const input = this.userInput.trim();
    if (!input) return;

    this.messages.push({ user: "You", text: input });
    this.isTyping = true;

    const chatHistory = this.messages.map((m) => ({
      role: m.user === "You" ? "user" : "assistant",
      content: m.text,
    }));

    this.http
      .post<any>("/trackFood", {
        text: input,
        uid: this.uid,
        chatHistory,
      })
      .subscribe({
        next: (res: any) => {
          this.isTyping = false;
          this.messages.push({
            user: "Tracker",
            nutrition: res.nutrition || null,
            quickReplies: res.quickReplies || null,
            items: res.items,
          });
          this.isLoadingGoal = true;
          this.showGoalSummary = true;
          setTimeout(() => {
            this.setDisplayedNutrients(res.goal);
            this.isLoadingGoal = false;
          }, 500);
          this.isLoadingGoal = false;
          this.messages.push({
            user: "Tracker",
            goalSummary: res.goal,
          });
        },
        error: () => {
          const suggestions = [
            "Try something like: '2 scrambled eggs and toast'",
            "Try saying: 'I had a banana and coffee'",
            "Say something like: 'a bowl of cereal and milk'",
            "How about: 'a cup of yogurt and granola'",
          ];
          const fallback =
            suggestions[Math.floor(Math.random() * suggestions.length)];
          this.isTyping = false;
          this.messages.push({
            user: "Tracker",
            text: `Hmm, I didn’t quite catch that. ${fallback}`,
          });
        },
      });

    this.userInput = "";
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") this.sendMessage();
  }

  toggleTheme() {
    this.theme = this.theme === "light" ? "dark" : "light";
    document.body.className = `${this.theme}-mode`;
    localStorage.setItem("theme", this.theme);
  }

  handleImageUpload(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
  
    const reader = new FileReader();
  
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scale = MAX_WIDTH / img.width;
  
        canvas.width = Math.min(img.width, MAX_WIDTH);
        canvas.height = img.height * scale;
  
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
  
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  
        // ✅ Compress to JPEG at 70% quality
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

        debugger;
  
        // Send compressed image to OpenAI
        this.sendImageToAI(compressedBase64);
      };
  
      img.src = reader.result as string;
    };
  
    reader.readAsDataURL(file);
  }  

  triggerFileInput() {
    this.fileInput.nativeElement.value = ''; // reset for repeated selections
    this.fileInput.nativeElement.click();
  }

  async startCamera() {
    this.capturedImage = null;
  
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" } }
      });
  
      this.showCamera = true;
  
      setTimeout(() => {
        const video = this.video?.nativeElement;
        if (!video) return;
  
        video.setAttribute("playsinline", "");
        video.srcObject = stream;
        video.play();
      }, 0);
    } catch (err) {
      console.warn('Rear camera not available, falling back to default');
      const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
  
      this.showCamera = true;
  
      setTimeout(() => {
        const video = this.video?.nativeElement;
        if (!video) return;
  
        video.setAttribute("playsinline", "");
        video.srcObject = fallbackStream;
        video.play();
      }, 0);
    }
  }
  

  capturePhoto() {
    const video = this.video.nativeElement;
    const canvas = this.canvas.nativeElement;
    const ctx = canvas.getContext("2d");
  
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
  
    this.capturedImage = canvas.toDataURL("image/png");
  
    this.showCamera = false;
  
    // Stop the stream
    const stream = video.srcObject as MediaStream;
    stream.getTracks().forEach((track) => track.stop());
  }

  sendCapturedPhoto() {
    if (this.capturedImage) {
      this.sendImageToAI(this.capturedImage);
    }
    this.closeCamera();
  }

  closeCamera() {
    const videoEl = this.video.nativeElement;
    const stream = videoEl.srcObject as MediaStream;
    stream?.getTracks().forEach((track) => track.stop());

    this.showCamera = false;
    this.capturedImage = null;
  }

  sendImageToAI(imageData: string) {
    this.isTyping = true;
  
    // 👇 Add the uploaded image to the chat
    this.messages.push({
      user: "You",
      text: "[Uploaded Image]",
      imageUrl: imageData,
    });
  
    this.http
      .post<any>("/trackFoodImage", {
        uid: this.uid,
        image: imageData,
      })
      .subscribe({
        next: (res: any) => {
          this.isTyping = false;
  
          this.messages.push({
            user: "Tracker",
            nutrition: res.nutrition,
            items: res.items,
          });
  
          this.isLoadingGoal = true;
          this.showGoalSummary = true;
  
          setTimeout(() => {
            this.setDisplayedNutrients(res.goal);
            this.isLoadingGoal = false;
          }, 500);
  
          this.messages.push({
            user: "Tracker",
            goalSummary: res.goal,
          });
        },
        error: () => {
          this.isTyping = false;
          this.messages.push({
            user: "Tracker",
            text: "Sorry, something went wrong with image processing.",
          });
        },
      });
  }
  setDisplayedNutrients(goal: any) {
    const nutrients = [
      { key: "calories", label: "Calories", unit: "", color: "#60A5FA" },
      { key: "protein", label: "Protein", unit: "g", color: "#D97706" },
      { key: "carbs", label: "Carbs", unit: "g", color: "#10B981" },
      { key: "fat", label: "Fats", unit: "g", color: "#A78BFA" },
    ];

    this.displayedNutrients = nutrients.map((n) => {
      const consumed = goal.goal[n.key] - goal.remaining[n.key];
      const percent = Math.min((consumed / goal.goal[n.key]) * 100, 100);

      return {
        ...n,
        consumed: Math.round(consumed),
        goal: Math.round(goal.goal[n.key]),
        left: Math.round(goal.remaining[n.key]),
        percent: Math.round(percent),
      };
    });
  }
}
