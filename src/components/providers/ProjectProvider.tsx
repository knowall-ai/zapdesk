'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ProjectContextType {
  currentProject: string | null; // Project name
  setCurrentProject: (project: string | null) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentProject, setCurrentProjectState] = useState<string | null>(null);

  const setCurrentProject = useCallback((project: string | null) => {
    setCurrentProjectState(project);
  }, []);

  return (
    <ProjectContext.Provider value={{ currentProject, setCurrentProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
