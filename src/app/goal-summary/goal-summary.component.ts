import { Component, Input, OnInit, Output, EventEmitter } from "@angular/core";

export interface NutrientData {
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
  selector: "app-goal-summary",
  templateUrl: "./goal-summary.component.html",
  styleUrls: ["./goal-summary.component.scss"],
})
export class GoalSummaryComponent implements OnInit {
  @Input() nutrients: NutrientData[] = [];
  @Input() isLoading = false;
  @Input() animate = false;
  @Output() dismiss = new EventEmitter<void>();
  isClosing = false;
  isEntering = false;

  onDismiss() {
    this.isClosing = true;
    setTimeout(() => this.dismiss.emit(), 300); // Wait for animation
  }

  constructor() {}

  ngOnInit() {
    setTimeout(() => {
      this.isEntering = true;
    }, 0); // triggers after render
  }
}
